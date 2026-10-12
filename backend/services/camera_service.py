import cv2
import time
import os
import logging
import asyncio
import numpy as np
from typing import Optional, Dict, Any, List, Set
from fastapi import WebSocket

from backend.vision.camera import VideoSource
from backend.vision.detector import PPEDetector, filter_person_detections
from backend.vision.tracker import PersonTracker, TrackedPerson
from backend.vision.compliance import ComplianceEngine
from backend.vision.face_id import FaceIdentityEngine
from backend.database.db import (
    record_or_update_incident,
    resolve_stale_incidents,
    get_all_worker_embeddings,
    get_all_zones,
    get_settings
)

logger = logging.getLogger("sentinelx.camera_service")

from backend.paths import DATA_DIR, SNAPSHOTS_DIR, ensure_data_directories
ensure_data_directories()

class CameraService:
    def __init__(self):
        self.video_source: Optional[VideoSource] = None
        self.detector: Optional[PPEDetector] = None
        self.tracker = PersonTracker()
        self.compliance_engine = ComplianceEngine()
        self.face_engine = FaceIdentityEngine()

        self.is_active = False
        self.camera_id = "CAM-01"
        self.camera_name = "Welding Safety Cam"
        self.zone_name = "Welding Area"
        self.source_desc = "0"
        self.source_type = "webcam"
        self.model_choice = "hansung"

        self.last_frame_bytes: Optional[bytes] = None
        self.active_tracked_workers: List[Dict[str, Any]] = []
        self.last_update_time = time.time()
        self.fps: float = 60.0
        self._frame_counter: int = 0
        self._last_fps_time: float = time.time()
        self._cached_person_dets: List[Dict[str, Any]] = []
        self._cached_ppe_dets: List[Dict[str, Any]] = []
        self._cached_frame_faces: List[Dict[str, Any]] = []

        # Settings
        self.conf_thresh = 0.35
        self.identity_thresh = 0.45
        self.sound_enabled = True
        self.alert_cooldown = 5.0
        self.last_sound_trigger_time: Dict[str, float] = {}

        # Worker gallery cache
        self.worker_gallery: List[Dict[str, Any]] = []
        self.refresh_worker_gallery()

        # WebSockets for live telemetry
        self.ws_clients: Set[WebSocket] = set()

        # Running thread/loop flag
        self.processing_task: Optional[asyncio.Task] = None

        # Initialize detector
        self.init_detector()

    def refresh_worker_gallery(self):
        try:
            self.worker_gallery = get_all_worker_embeddings()
            logger.info(f"Loaded {len(self.worker_gallery)} registered worker face embeddings into memory.")
        except Exception as e:
            logger.error(f"Error loading worker gallery: {e}")

    def init_detector(self, model_choice: str = "hansung"):
        self.model_choice = model_choice
        model_file = "models/yolov8_ppe_hansung.pt" if model_choice == "hansung" else "models/yolov8_ppe_6class.pt"
        self.detector = PPEDetector(model_path=model_file, conf_thresh=self.conf_thresh)
        logger.info(f"Initialized PPEDetector with {model_choice} model.")

    def start_camera(
        self,
        camera_id: str = "CAM-01",
        camera_name: str = "Welding Safety Cam",
        zone: str = "Welding Area",
        source: str = "0",
        source_type: str = "webcam",
        conf_thresh: float = 0.35,
        model_choice: str = "hansung"
    ) -> Dict[str, Any]:
        if self.is_active:
            self.stop_camera()

        self.camera_id = camera_id
        self.camera_name = camera_name
        self.zone_name = zone
        self.source_desc = source
        self.source_type = source_type
        self.conf_thresh = conf_thresh

        if model_choice != self.model_choice:
            self.init_detector(model_choice)
        elif self.detector:
            self.detector.conf_thresh = conf_thresh

        # Reload settings from DB
        settings = get_settings()
        self.identity_thresh = float(settings.get("identity_confidence_threshold", "0.45"))
        self.sound_enabled = settings.get("sound_alerts_enabled", "true").lower() == "true"
        self.alert_cooldown = float(settings.get("alert_cooldown_seconds", "5"))

        self.refresh_worker_gallery()

        is_webcam = (source_type == "webcam")
        self.tracker.reset()
        self.video_source = VideoSource(source=source, is_webcam=is_webcam)
        self.video_source.start()

        self.is_active = True
        self.camera_started_at = time.time()
        self.last_sound_trigger_time.clear()
        self.error_message = None
        logger.info(f"Started camera {camera_id} ({source}) in zone {zone}")

        return {
            "status": "success",
            "camera_id": camera_id,
            "source": source,
            "zone": zone,
            "model": self.model_choice,
            "supported_classes": self.detector.supported_canonical if self.detector else []
        }

    def stop_camera(self):
        self.is_active = False
        if self.video_source:
            self.video_source.stop()
            self.video_source = None
        self.tracker.reset()
        self.active_tracked_workers = []
        self.last_frame_bytes = None
        self.last_sound_trigger_time.clear()
        logger.info("Camera service stopped.")

    def process_current_frame(self) -> Optional[np.ndarray]:
        """
        Runs one step of detection, tracking, identification, compliance checking,
        incident management, and drawing.
        """
        if not self.is_active or not self.video_source:
            return None

        ret, frame = self.video_source.read()
        if not ret or frame is None:
            return None

        # Clean up stale incidents periodically
        resolve_stale_incidents(threshold_seconds=4.0)

        h, w = frame.shape[:2]
        # In 60 FPS mode: run deep neural network inference on interleaved frames (30Hz)
        # while tracking, smoothing, and stream output run at the full 60 FPS
        should_run_nn = (self._frame_counter % 2 == 0) or (len(self._cached_frame_faces) == 0)

        if should_run_nn:
            # 1. Run YOLO inference
            detections = self.detector.detect(frame) if self.detector else []
            raw_person_dets = [d for d in detections if d["canonical_class"] == "person"]
            ppe_dets = [d for d in detections if d["canonical_class"] != "person"]

            # Run full-frame face detection with YuNet (all faces in camera with zero crop clipping)
            frame_faces = []
            if self.face_engine and self.face_engine.is_ready:
                try:
                    raw_faces = self.face_engine.detect_all_faces(frame)
                    for f in raw_faces:
                        fx, fy, fw_f, fh_f = f[:4]
                        emb = self.face_engine.extract_embedding(frame, f)
                        mid, mname, conf, mrec = (None, None, 0.0, None)
                        if emb is not None:
                            mid, mname, conf, mrec = self.face_engine.match_against_gallery(
                                emb, self.worker_gallery, threshold=self.identity_thresh
                            )
                        frame_faces.append({
                            "center": (float(fx + fw_f / 2.0), float(fy + fh_f / 2.0)),
                            "box": [float(fx), float(fy), float(fx + fw_f), float(fy + fh_f)],
                            "matched_id": mid,
                            "matched_name": mname,
                            "matched_record": mrec,
                            "conf": conf,
                            "score": float(f[-1])
                        })
                except Exception as e:
                    logger.debug(f"Full-frame face detection error: {e}")

            self._cached_person_dets = raw_person_dets
            self._cached_ppe_dets = ppe_dets
            self._cached_frame_faces = frame_faces
        else:
            raw_person_dets = self._cached_person_dets
            ppe_dets = self._cached_ppe_dets
            frame_faces = self._cached_frame_faces

        # Filter spurious person false positives (e.g. hanging clothes/jackets on wall)
        # Low confidence detections (< 0.48) without a human face are suppressed
        valid_raw_persons = []
        for p in raw_person_dets:
            p_conf = p.get("confidence", 0.0)
            box = p["box"]
            has_face = any(
                (box[0] - 35 <= fc["center"][0] <= box[2] + 35) and
                (box[1] - 35 <= fc["center"][1] <= box[1] + (box[3] - box[1]) * 0.85)
                for fc in frame_faces
            )
            if has_face or p_conf >= 0.48:
                valid_raw_persons.append(p)

        # Guarantee that every clearly detected human face has a corresponding person tracking box
        # (Crucial for close-up webcam views where full-body YOLO person boxes may not trigger)
        for fc in frame_faces:
            fc_x, fc_y = fc["center"]
            fb = fc["box"]
            covered = any(
                (p["box"][0] - 35 <= fc_x <= p["box"][2] + 35) and
                (p["box"][1] - 35 <= fc_y <= p["box"][3] + 35)
                for p in valid_raw_persons
            )
            if not covered:
                fw = max(40.0, fb[2] - fb[0])
                fh = max(40.0, fb[3] - fb[1])
                ub_x1 = max(0.0, fb[0] - 1.2 * fw)
                ub_y1 = max(0.0, fb[1] - 0.25 * fh)
                ub_x2 = min(float(w), fb[2] + 1.2 * fw)
                ub_y2 = min(float(h), fb[3] + 4.5 * fh)
                valid_raw_persons.append({
                    "box": [ub_x1, ub_y1, ub_x2, ub_y2],
                    "confidence": max(0.70, fc.get("score", 0.85)),
                    "raw_class": "person",
                    "canonical_class": "person"
                })

        person_dets = filter_person_detections(
            valid_raw_persons,
            frame_shape=(h, w),
            iou_thresh=0.35,
            containment_thresh=0.60,
            min_person_conf=self.conf_thresh
        )

        # 3. Update multi-object person tracker
        tracked_persons = self.tracker.update(person_dets)

        # 4. Multi-person Exclusive PPE spatial association
        person_boxes = [track.box for track in tracked_persons]
        assigned_ppe_per_person = self.compliance_engine.associate_ppe_to_people(person_boxes, ppe_dets)

        # Determine default required PPE for this zone
        default_required_ppe = ["helmet", "safety_vest"]

        annotated_frame = frame.copy()
        current_workers_payload = []
        now = time.time()

        for idx, track in enumerate(tracked_persons):
            bx1, by1, bx2, by2 = [int(v) for v in track.box]
            bx1, by1 = max(0, bx1), max(0, by1)
            bx2, by2 = min(w, bx2), min(h, by2)

            # 5. Identity Verification with Temporal Confirmation
            # Sample face recognition: match faces whose center falls within this person's upper body / head
            matched_face_info = None
            for ff in frame_faces:
                fc_x, fc_y = ff["center"]
                if (bx1 - 35 <= fc_x <= bx2 + 35) and (by1 - 35 <= fc_y <= by1 + (by2 - by1) * 0.75):
                    matched_face_info = ff
                    break

            if matched_face_info and matched_face_info["matched_id"]:
                cand_id = matched_face_info["matched_id"]
                track.identity_history.append(cand_id)
                track.identity_history = track.identity_history[-6:]  # Keep last 6 observations

                # Require at least 2 consistent observations to confirm identity (temporal confirmation)
                if track.identity_history.count(cand_id) >= 2 or track.worker_id == cand_id:
                    rec = matched_face_info.get("matched_record") or {}
                    track.worker_id = cand_id
                    track.worker_name = matched_face_info["matched_name"] or rec.get("name", "Unknown Worker")
                    track.department = rec.get("department", "General")
                    track.designation = rec.get("designation", "Operator")
                    track.photo_path = rec.get("photo_path", "")
                    track.identity_confidence = matched_face_info["conf"]
            elif track.worker_id is None:
                # Strictly UNKNOWN PERSON: no guessing, no arbitrary assignment
                track.worker_name = None
                track.department = None
                track.designation = None
                track.photo_path = None
                track.identity_confidence = 0.0

            # Determine required PPE based on identity
            if track.worker_id:
                worker_record = next((w for w in self.worker_gallery if w["worker_id"] == track.worker_id), None)
                required_ppe = worker_record.get("required_ppe", default_required_ppe) if worker_record else default_required_ppe
            else:
                # UNKNOWN PERSON: strictly fallback to zone default PPE
                required_ppe = default_required_ppe

            # 6. Evaluate compliance with exclusively assigned PPE items
            person_ppe = assigned_ppe_per_person[idx] if idx < len(assigned_ppe_per_person) else []
            supported_classes = self.detector.supported_canonical if self.detector else []

            ppe_status, compliance_pct, violations = self.compliance_engine.evaluate_person(
                track.box,
                person_ppe,
                required_ppe,
                supported_classes,
                track_total_frames=track.total_frames,
                frame_shape=(h, w)
            )

            track.ppe_status = ppe_status
            track.compliance_score = compliance_pct
            track.violations = violations

            is_violation = len(violations) > 0
            trigger_sound = False

            # 7. Incident Management & Snapshot Storage
            if is_violation:
                violation_summary = " & ".join(violations)
                severity = "HIGH" if any("Helmet" in v for v in violations) else "MEDIUM"

                # Check if we should trigger an audible alert based on cooldown
                has_target_violation = len(violations) > 0
                camera_uptime = now - getattr(self, "camera_started_at", 0.0)
                is_stabilized = (track.total_frames >= 4) and (camera_uptime >= 1.5)

                actor_key = track.worker_id if track.worker_id else f"track_{track.track_id}"
                last_sound = self.last_sound_trigger_time.get(actor_key, 0.0)
                if self.sound_enabled and has_target_violation and is_stabilized and (now - last_sound > self.alert_cooldown):
                    trigger_sound = True
                    self.last_sound_trigger_time[actor_key] = now

                # Call incident grouping in DB (with track_id for distinct unknown persons)
                inc_result = record_or_update_incident(
                    worker_id=track.worker_id,
                    worker_name=track.worker_name,
                    camera_id=self.camera_id,
                    zone=self.zone_name,
                    violation_type=violation_summary,
                    detected_ppe=[k for k, v in ppe_status.items() if v.get("detected")],
                    missing_ppe=[k for k, v in ppe_status.items() if v.get("status") == "MISSING"],
                    severity=severity,
                    identity_confidence=track.identity_confidence,
                    detection_confidence=track.confidence,
                    snapshot_path="",
                    track_id=track.track_id
                )

                # If this was a newly created incident, save annotated snapshot
                if inc_result.get("is_new"):
                    snap_filename = f"snap_inc_{inc_result['incident_id']}_{int(now)}.jpg"
                    snap_abs_path = os.path.join(SNAPSHOTS_DIR, snap_filename)
                    cv2.imwrite(snap_abs_path, frame)
                    snapshot_rel_path = f"data/snapshots/{snap_filename}"
                    from backend.database.db import get_connection
                    conn = get_connection()
                    conn.execute("UPDATE incidents SET snapshot_path = ? WHERE id = ?;", (snapshot_rel_path, inc_result["incident_id"]))
                    conn.commit()
                    conn.close()

            # 8. Draw annotations on frame (Industrial High-Tech Style)
            is_identified = track.worker_id is not None
            box_color = (68, 68, 239) if is_violation else (94, 197, 34)  # Red if violation, Green if compliant
            accent_color = (0, 217, 255) if is_identified else (0, 165, 255)  # Cyan for verified, Amber for unknown

            # Draw person box with corners
            cv2.rectangle(annotated_frame, (bx1, by1), (bx2, by2), box_color, 2)
            corner_len = min(20, (bx2 - bx1) // 4)
            for cx, cy in [(bx1, by1), (bx2, by1), (bx1, by2), (bx2, by2)]:
                dx = corner_len if cx == bx1 else -corner_len
                dy = corner_len if cy == by1 else -corner_len
                cv2.line(annotated_frame, (cx, cy), (cx + dx, cy), accent_color, 3)
                cv2.line(annotated_frame, (cx, cy), (cx, cy + dy), accent_color, 3)

            # Header tag
            if is_identified:
                dept_label = f" [{track.department}]" if track.department else ""
                badge_text = f"TRACK #{track.track_id} | {track.worker_id} - {track.worker_name}{dept_label} ({int(track.identity_confidence*100)}%)"
            else:
                badge_text = f"TRACK #{track.track_id} | UNKNOWN PERSON"

            (tw, th), _ = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
            cv2.rectangle(annotated_frame, (bx1, max(0, by1 - 26)), (bx1 + tw + 14, by1), (23, 32, 51), -1)
            cv2.putText(annotated_frame, badge_text, (bx1 + 6, max(16, by1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (248, 250, 252), 1)

            # Bottom status pill
            status_text = f"VIOLATION: {', '.join(violations)}" if is_violation else "ALL REQUIRED PPE COMPLIANT"
            status_col = (68, 68, 239) if is_violation else (94, 197, 34)
            cv2.putText(annotated_frame, status_text, (bx1 + 6, by2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.48, status_col, 2)

            current_workers_payload.append({
                "track_id": track.track_id,
                "worker_id": track.worker_id,
                "worker_name": track.worker_name or "UNKNOWN PERSON",
                "department": track.department or ("Unregistered" if not is_identified else ""),
                "designation": track.designation or "",
                "photo_path": track.photo_path or "",
                "identity_confidence": track.identity_confidence,
                "is_identified": is_identified,
                "box": [bx1, by1, bx2, by2],
                "compliance_score": compliance_pct,
                "is_violation": is_violation,
                "violations": violations,
                "ppe_status": ppe_status,
                "trigger_sound": trigger_sound
            })

        # Draw PPE bounding boxes in cyan/yellow
        for item in ppe_dets:
            px1, py1, px2, py2 = [int(v) for v in item["box"]]
            c_class = item["canonical_class"]
            conf = item["confidence"]
            cv2.rectangle(annotated_frame, (px1, py1), (px2, py2), (255, 217, 0), 1)
            cv2.putText(annotated_frame, f"{c_class} {int(conf*100)}%", (px1, max(14, py1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 217, 0), 1)

        # Encode JPEG for stream
        _, jpeg = cv2.imencode(".jpg", annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        self.last_frame_bytes = jpeg.tobytes()
        self.active_tracked_workers = current_workers_payload
        self.last_update_time = now

        self._frame_counter += 1
        t_diff = now - self._last_fps_time
        if t_diff >= 1.0:
            self.fps = round(self._frame_counter / t_diff, 1)
            self._frame_counter = 0
            self._last_fps_time = now

        return annotated_frame

    def get_detections_payload(self) -> Dict[str, Any]:
        return {
            "camera_id": self.camera_id,
            "camera_name": self.camera_name,
            "zone": self.zone_name,
            "is_active": self.is_active,
            "fps": self.fps,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "model_choice": self.model_choice,
            "supported_classes": self.detector.supported_canonical if self.detector else [],
            "tracked_people": self.active_tracked_workers,
            "people_count": len(self.active_tracked_workers),
            "violation_count": sum(1 for w in self.active_tracked_workers if w["is_violation"])
        }

    async def broadcast_ws(self):
        if not self.ws_clients:
            return
        payload = self.get_detections_payload()
        disconnected = set()
        for ws in self.ws_clients:
            try:
                await ws.send_json(payload)
            except Exception:
                disconnected.add(ws)
        self.ws_clients -= disconnected

camera_service = CameraService()
