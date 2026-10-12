import cv2
import time
import os
import json
import logging
import threading
from typing import Optional, Dict, Any, List, Set, Tuple

import numpy as np

from backend.vision.detector import PPEDetector, filter_person_detections
from backend.vision.tracker import PersonTracker, TrackedPerson
from backend.vision.compliance import ComplianceEngine
from backend.vision.face_id import FaceIdentityEngine
from backend.database.db import (
    get_connection,
    get_all_worker_embeddings,
    create_video_analysis,
    update_video_analysis,
    get_video_analysis
)

logger = logging.getLogger("sentinelx.video_analysis")

from backend.paths import DATA_DIR, UPLOADS_DIR, SNAPSHOTS_DIR, ensure_data_directories
ensure_data_directories()

def format_seconds_to_hhmmss(seconds: float) -> str:
    total_sec = max(0, int(seconds))
    hrs = total_sec // 3600
    mins = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"

class VideoAnalysisService:
    def __init__(self):
        self.lock = threading.Lock()
        
        # Models and engines
        self.detector: Optional[PPEDetector] = None
        self.tracker = PersonTracker()
        self.compliance_engine = ComplianceEngine()
        self.face_engine = FaceIdentityEngine()
        self.worker_gallery: List[Dict[str, Any]] = []

        # State management
        self.status: str = "IDLE"  # IDLE, ANALYZING, PAUSED, COMPLETED, CANCELLED, ERROR
        self.current_analysis_id: Optional[int] = None
        self.file_path: Optional[str] = None
        self.filename: Optional[str] = None
        self.error_message: Optional[str] = None

        # Control flags
        self._pause_event = threading.Event()
        self._pause_event.set()  # Unpaused by default
        self._cancel_flag = False
        self._worker_thread: Optional[threading.Thread] = None

        # Live Progress & Telemetry
        self.total_frames: int = 0
        self.processed_frames: int = 0
        self.current_frame_idx: int = 0
        self.fps: float = 30.0
        self.duration_seconds: float = 0.0
        self.current_video_sec: float = 0.0
        self.current_video_timestamp: str = "00:00"
        self.progress_percent: float = 0.0
        self.processing_fps: float = 0.0
        self.latest_annotated_jpeg: Optional[bytes] = None

        # Live Results Accumulation
        self.tracked_people_set: Set[int] = set()
        self.identified_workers_map: Dict[str, str] = {}  # worker_id -> name
        self.unknown_tracks_set: Set[int] = set()
        self.timeline_incidents: List[Dict[str, Any]] = []
        self.violations_by_type: Dict[str, int] = {}
        self.uncertain_count: int = 0
        
        # Debouncing active incidents during analysis
        # Key: (actor_key, violation_type) -> incident dict
        self._active_incidents: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self.incident_continuation_window: float = 3.5  # video seconds

        self.refresh_worker_gallery()
        self._init_default_detector()

    def refresh_worker_gallery(self):
        try:
            self.worker_gallery = get_all_worker_embeddings()
            logger.info(f"Loaded {len(self.worker_gallery)} registered worker face embeddings for video analysis.")
        except Exception as e:
            logger.error(f"Error loading worker gallery: {e}")

    def _init_default_detector(self, model_choice: str = "hansung"):
        try:
            model_file = "models/yolov8_ppe_hansung.pt" if model_choice == "hansung" else "models/yolov8_ppe_6class.pt"
            self.detector = PPEDetector(model_path=model_file, conf_thresh=0.35)
        except Exception as e:
            logger.error(f"Failed to initialize default detector: {e}")

    def validate_and_get_metadata(self, file_path: str) -> Dict[str, Any]:
        """Validates video file readability, codecs, and extracts full metadata."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Video file does not exist: {file_path}")

        file_size_bytes = os.path.getsize(file_path)
        if file_size_bytes == 0:
            raise ValueError("Uploaded video file is empty (0 bytes).")

        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            raise ValueError(f"Unable to decode video format. Codec or file format is invalid/corrupted: {os.path.basename(file_path)}")

        try:
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

            if fps <= 0 or np.isnan(fps):
                fps = 30.0  # safe fallback
            if total_frames <= 0:
                # Count manually if needed or estimate
                total_frames = 1

            duration_sec = total_frames / fps
            formatted_duration = format_seconds_to_hhmmss(duration_sec)

            # Read test frame to verify actual readability
            ret, test_frame = cap.read()
            if not ret or test_frame is None:
                raise ValueError("Video file header is valid but frames cannot be decoded.")

            return {
                "filename": os.path.basename(file_path),
                "file_path": file_path,
                "file_size_bytes": file_size_bytes,
                "file_size_formatted": f"{file_size_bytes / (1024 * 1024):.2f} MB",
                "width": width,
                "height": height,
                "resolution": f"{width}x{height}",
                "fps": round(fps, 2),
                "total_frames": total_frames,
                "duration_seconds": round(duration_sec, 2),
                "formatted_duration": formatted_duration,
                "is_readable": True
            }
        finally:
            cap.release()

    def start_analysis(
        self,
        file_path: str,
        model_choice: str = "hansung",
        conf_thresh: float = 0.35,
        identity_thresh: float = 0.45,
        required_ppe: Optional[List[str]] = None,
        frame_step: int = 3,
        zone_name: str = "Recorded Video Analysis"
    ) -> Dict[str, Any]:
        with self.lock:
            if self.status in ["ANALYZING", "PAUSED"]:
                raise RuntimeError("An analysis session is already running. Please pause, stop, or wait for it to complete.")

            meta = self.validate_and_get_metadata(file_path)

            if required_ppe is None:
                required_ppe = ["helmet", "safety_vest"]

            # Initialize detector if model changed
            model_file = "models/yolov8_ppe_hansung.pt" if model_choice == "hansung" else "models/yolov8_ppe_6class.pt"
            self.detector = PPEDetector(model_path=model_file, conf_thresh=conf_thresh)
            self.refresh_worker_gallery()

            self.file_path = file_path
            self.filename = meta["filename"]
            self.total_frames = meta["total_frames"]
            self.fps = meta["fps"]
            self.duration_seconds = meta["duration_seconds"]
            self.processed_frames = 0
            self.current_frame_idx = 0
            self.current_video_sec = 0.0
            self.current_video_timestamp = "00:00"
            self.progress_percent = 0.0
            self.processing_fps = 0.0
            self.error_message = None

            # Reset tracking and results
            self.tracker.reset()
            self.tracked_people_set.clear()
            self.identified_workers_map.clear()
            self.unknown_tracks_set.clear()
            self.timeline_incidents.clear()
            self.violations_by_type.clear()
            self.uncertain_count = 0
            self._active_incidents.clear()

            # Control flags
            self._cancel_flag = False
            self._pause_event.set()
            self.status = "ANALYZING"

            # Create DB analysis record
            analysis_data = {
                "filename": self.filename,
                "file_path": self.file_path,
                "file_size_bytes": meta["file_size_bytes"],
                "duration_seconds": self.duration_seconds,
                "resolution": meta["resolution"],
                "fps": self.fps,
                "total_frames": self.total_frames,
                "processed_frames": 0,
                "status": "ANALYZING",
                "policy_applied": required_ppe,
                "model_used": model_choice,
                "unique_people": 0,
                "identified_workers": 0,
                "unknown_persons": 0,
                "violation_count": 0,
                "uncertain_count": 0,
                "summary_json": {}
            }
            self.current_analysis_id = create_video_analysis(analysis_data)

            # Spawn worker thread
            self._worker_thread = threading.Thread(
                target=self._run_analysis_pipeline,
                args=(file_path, conf_thresh, identity_thresh, required_ppe, frame_step, zone_name),
                daemon=True
            )
            self._worker_thread.start()

            return {
                "status": "started",
                "analysis_id": self.current_analysis_id,
                "metadata": meta,
                "policy": required_ppe,
                "frame_step": frame_step
            }

    def pause_analysis(self) -> Dict[str, Any]:
        with self.lock:
            if self.status != "ANALYZING":
                return {"status": self.status, "message": "Cannot pause when not actively analyzing."}
            self._pause_event.clear()
            self.status = "PAUSED"
            if self.current_analysis_id:
                update_video_analysis(self.current_analysis_id, {"status": "PAUSED"})
            return {"status": "PAUSED", "current_timestamp": self.current_video_timestamp}

    def resume_analysis(self) -> Dict[str, Any]:
        with self.lock:
            if self.status != "PAUSED":
                return {"status": self.status, "message": "Cannot resume when not paused."}
            self._pause_event.set()
            self.status = "ANALYZING"
            if self.current_analysis_id:
                update_video_analysis(self.current_analysis_id, {"status": "ANALYZING"})
            return {"status": "ANALYZING", "current_timestamp": self.current_video_timestamp}

    def cancel_analysis(self) -> Dict[str, Any]:
        with self.lock:
            if self.status not in ["ANALYZING", "PAUSED"]:
                return {"status": self.status, "message": "No active analysis to cancel."}
            self._cancel_flag = True
            self._pause_event.set()  # Unblock thread if paused so it can exit
            self.status = "CANCELLED"
            if self.current_analysis_id:
                update_video_analysis(self.current_analysis_id, {
                    "status": "CANCELLED",
                    "processed_frames": self.processed_frames
                })
            return {"status": "CANCELLED", "current_timestamp": self.current_video_timestamp}

    def get_status_payload(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "analysis_id": self.current_analysis_id,
                "filename": self.filename,
                "current_frame": self.current_frame_idx,
                "total_frames": self.total_frames,
                "processed_frames": self.processed_frames,
                "progress_percent": round(self.progress_percent, 1),
                "current_video_timestamp": self.current_video_timestamp,
                "duration_seconds": self.duration_seconds,
                "formatted_duration": format_seconds_to_hhmmss(self.duration_seconds),
                "processing_fps": round(self.processing_fps, 1),
                "unique_people_count": len(self.tracked_people_set),
                "identified_workers_count": len(self.identified_workers_map),
                "unknown_persons_count": len(self.unknown_tracks_set),
                "confirmed_violations_count": len(self.timeline_incidents),
                "violations_by_type": dict(self.violations_by_type),
                "uncertain_count": self.uncertain_count,
                "is_paused": self.status == "PAUSED",
                "error_message": self.error_message
            }

    def get_results_summary(self) -> Dict[str, Any]:
        with self.lock:
            coverage_pct = round((self.processed_frames / max(1, self.total_frames)) * 100, 1)
            return {
                "analysis_id": self.current_analysis_id,
                "filename": self.filename,
                "file_path": self.file_path,
                "status": self.status,
                "total_duration_seconds": self.duration_seconds,
                "formatted_duration": format_seconds_to_hhmmss(self.duration_seconds),
                "total_frames": self.total_frames,
                "processed_frames": self.processed_frames,
                "coverage_pct": coverage_pct,
                "unique_people_count": len(self.tracked_people_set),
                "identified_workers": [
                    {"worker_id": wid, "name": wname}
                    for wid, wname in self.identified_workers_map.items()
                ],
                "identified_workers_count": len(self.identified_workers_map),
                "unknown_persons_count": len(self.unknown_tracks_set),
                "confirmed_violations_count": len(self.timeline_incidents),
                "violations_by_type": dict(self.violations_by_type),
                "uncertain_count": self.uncertain_count,
                "timeline": list(self.timeline_incidents),
                "error_message": self.error_message
            }

    def get_latest_frame_jpeg(self) -> Optional[bytes]:
        with self.lock:
            return self.latest_annotated_jpeg

    # ------------------ BACKGROUND PROCESSING PIPELINE ------------------ #

    def _run_analysis_pipeline(
        self,
        file_path: str,
        conf_thresh: float,
        identity_thresh: float,
        required_ppe: List[str],
        frame_step: int,
        zone_name: str
    ):
        logger.info(f"Starting recorded video processing pipeline for: {file_path}")
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            self.status = "ERROR"
            self.error_message = f"Failed to open video file: {file_path}"
            return

        start_clock = time.time()
        fps_clock = time.time()
        frames_in_batch = 0
        frame_idx = 0

        try:
            while cap.isOpened():
                if self._cancel_flag:
                    logger.info("Analysis cancelled by user.")
                    self.status = "CANCELLED"
                    break

                # Handle pause
                if not self._pause_event.is_set():
                    time.sleep(0.1)
                    continue

                # Read next frame
                ret, frame = cap.read()
                if not ret or frame is None:
                    # Video stream ended naturally
                    logger.info("Reached end of recorded video file.")
                    break

                frame_idx += 1
                self.current_frame_idx = frame_idx
                self.current_video_sec = frame_idx / self.fps
                self.current_video_timestamp = format_seconds_to_hhmmss(self.current_video_sec)
                self.progress_percent = min(100.0, (frame_idx / max(1, self.total_frames)) * 100.0)

                # Skip frame if not on frame_step stride
                if frame_step > 1 and (frame_idx % frame_step != 0):
                    continue

                self.processed_frames += 1
                frames_in_batch += 1

                # Calculate processing FPS periodically
                now_clk = time.time()
                if now_clk - fps_clock >= 1.0:
                    self.processing_fps = frames_in_batch / (now_clk - fps_clock)
                    fps_clock = now_clk
                    frames_in_batch = 0

                # Execute AI Detection & Analysis on current frame
                self._process_single_frame(
                    frame=frame,
                    video_sec=self.current_video_sec,
                    video_timestamp=self.current_video_timestamp,
                    conf_thresh=conf_thresh,
                    identity_thresh=identity_thresh,
                    required_ppe=required_ppe,
                    zone_name=zone_name
                )

            # End of video processing: finalize remaining active incidents
            self._finalize_all_active_incidents()

            if not self._cancel_flag and self.status != "ERROR":
                self.status = "COMPLETED"
                self.progress_percent = 100.0
                total_proc_time = round(time.time() - start_clock, 2)
                logger.info(f"Analysis completed in {total_proc_time}s. Processed {self.processed_frames} frames.")

                # Persist final results to DB
                results_summary = self.get_results_summary()
                if self.current_analysis_id:
                    update_video_analysis(self.current_analysis_id, {
                        "status": "COMPLETED",
                        "processed_frames": self.processed_frames,
                        "unique_people": len(self.tracked_people_set),
                        "identified_workers": len(self.identified_workers_map),
                        "unknown_persons": len(self.unknown_tracks_set),
                        "violation_count": len(self.timeline_incidents),
                        "uncertain_count": self.uncertain_count,
                        "summary_json": results_summary
                    })

        except Exception as e:
            logger.exception(f"Error in video analysis worker: {e}")
            self.status = "ERROR"
            self.error_message = str(e)
            if self.current_analysis_id:
                update_video_analysis(self.current_analysis_id, {
                    "status": "ERROR",
                    "summary_json": {"error": str(e)}
                })
        finally:
            cap.release()
            logger.info("Video resources released.")

    def _process_single_frame(
        self,
        frame: np.ndarray,
        video_sec: float,
        video_timestamp: str,
        conf_thresh: float,
        identity_thresh: float,
        required_ppe: List[str],
        zone_name: str
    ):
        h, w = frame.shape[:2]

        # 1. Run YOLO inference
        detections = self.detector.detect(frame) if self.detector else []
        raw_person_dets = [d for d in detections if d["canonical_class"] == "person"]
        ppe_dets = [d for d in detections if d["canonical_class"] != "person"]

        # 2. Face Detection & Recognition Attempt
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
                            emb, self.worker_gallery, threshold=identity_thresh
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
                logger.debug(f"Face processing error: {e}")

        # Filter person false positives
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

        # Ensure clearly detected faces have upper-body box if person detector missed them
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
                valid_raw_persons.append({
                    "box": [max(0.0, fb[0] - 1.2 * fw), max(0.0, fb[1] - 0.25 * fh),
                            min(float(w), fb[2] + 1.2 * fw), min(float(h), fb[3] + 4.5 * fh)],
                    "confidence": max(0.70, fc.get("score", 0.85)),
                    "raw_class": "person",
                    "canonical_class": "person"
                })

        person_dets = filter_person_detections(
            valid_raw_persons,
            frame_shape=(h, w),
            iou_thresh=0.35,
            containment_thresh=0.60,
            min_person_conf=conf_thresh
        )

        # 3. Multi-Person Tracker
        tracked_persons = self.tracker.update(person_dets)

        # 4. Exclusive PPE-Person Association
        person_boxes = [track.box for track in tracked_persons]
        assigned_ppe = self.compliance_engine.associate_ppe_to_people(person_boxes, ppe_dets)
        supported_classes = self.detector.supported_canonical if self.detector else []

        annotated_frame = frame.copy()

        # Clean up stale video incidents that haven't been observed recently
        self._check_stale_active_incidents(video_sec)

        for idx, track in enumerate(tracked_persons):
            self.tracked_people_set.add(track.track_id)
            bx1, by1, bx2, by2 = [int(v) for v in track.box]
            bx1, by1 = max(0, bx1), max(0, by1)
            bx2, by2 = min(w, bx2), min(h, by2)

            # 5. Worker Identification with SFace + YuNet
            matched_face = None
            for ff in frame_faces:
                fc_x, fc_y = ff["center"]
                if (bx1 - 35 <= fc_x <= bx2 + 35) and (by1 - 35 <= fc_y <= by1 + (by2 - by1) * 0.75):
                    matched_face = ff
                    break

            if matched_face and matched_face["matched_id"]:
                cand_id = matched_face["matched_id"]
                track.identity_history.append(cand_id)
                track.identity_history = track.identity_history[-6:]
                if track.identity_history.count(cand_id) >= 2 or track.worker_id == cand_id:
                    track.worker_id = cand_id
                    track.worker_name = matched_face["matched_name"] or "Unknown Worker"
                    track.identity_confidence = matched_face["conf"]
                    self.identified_workers_map[cand_id] = track.worker_name
            elif track.worker_id is None:
                # STRICTLY UNKNOWN PERSON
                track.worker_name = None
                track.identity_confidence = 0.0
                self.unknown_tracks_set.add(track.track_id)

            # Determine Applicable PPE Policy:
            # For registered workers, check worker's requirement; for unknown person, use provided policy
            target_policy = required_ppe
            if track.worker_id:
                worker_rec = next((w for w in self.worker_gallery if w["worker_id"] == track.worker_id), None)
                if worker_rec and worker_rec.get("required_ppe"):
                    target_policy = worker_rec["required_ppe"]

            # 6. Compliance Evaluation
            person_ppe = assigned_ppe[idx] if idx < len(assigned_ppe) else []
            ppe_status, compliance_pct, violations = self.compliance_engine.evaluate_person(
                track.box,
                person_ppe,
                target_policy,
                supported_classes,
                track_total_frames=track.total_frames,
                frame_shape=(h, w)
            )

            track.ppe_status = ppe_status
            track.compliance_score = compliance_pct
            track.violations = violations

            # Count uncertain items
            for ppe_k, ppe_v in ppe_status.items():
                if ppe_v.get("status") == "UNCERTAIN":
                    self.uncertain_count += 1

            # 7. Debounced Incident Grouping & Snapshot Generation
            if violations and track.total_frames >= 2:
                violation_summary = " & ".join(violations)
                severity = "HIGH" if any("Helmet" in v for v in violations) else "MEDIUM"
                
                actor_key = track.worker_id if track.worker_id else f"UNKNOWN_track_{track.track_id}"
                actor_name = track.worker_name if track.worker_id else "UNKNOWN PERSON"
                actor_type = "REGISTERED_WORKER" if track.worker_id else "UNKNOWN_PERSON"

                missing_items = [k for k, v in ppe_status.items() if v.get("status") == "MISSING"]
                detected_items = [k for k, v in ppe_status.items() if v.get("detected")]

                self._group_and_record_incident(
                    actor_key=actor_key,
                    actor_type=actor_type,
                    worker_id=track.worker_id,
                    worker_name=actor_name,
                    violation_summary=violation_summary,
                    missing_items=missing_items,
                    detected_items=detected_items,
                    severity=severity,
                    video_sec=video_sec,
                    video_timestamp=video_timestamp,
                    frame=frame,
                    detection_conf=track.confidence,
                    identity_conf=track.identity_confidence,
                    zone_name=zone_name
                )

            # 8. Draw High-Tech Overlay on Annotated Preview
            self._draw_person_overlay(annotated_frame, track, bx1, by1, bx2, by2, ppe_status, violations)

        # Draw Global Video HUD Overlay
        self._draw_hud_watermark(annotated_frame, video_timestamp)

        # Store latest JPEG preview
        _, jpeg_buf = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        self.latest_annotated_jpeg = jpeg_buf.tobytes()

    def _group_and_record_incident(
        self,
        actor_key: str,
        actor_type: str,
        worker_id: Optional[str],
        worker_name: str,
        violation_summary: str,
        missing_items: List[str],
        detected_items: List[str],
        severity: str,
        video_sec: float,
        video_timestamp: str,
        frame: np.ndarray,
        detection_conf: float,
        identity_conf: float,
        zone_name: str
    ):
        cache_key = (actor_key, violation_summary)
        existing = self._active_incidents.get(cache_key)

        if existing and (video_sec - existing["last_seen_sec"] <= self.incident_continuation_window):
            # Continue existing violation incident: update duration and end timestamp
            existing["last_seen_sec"] = video_sec
            existing["end_timestamp"] = video_timestamp
            existing["duration_seconds"] = round(video_sec - existing["start_sec"] + 1.0, 1)

            # Update DB row
            conn = get_connection()
            try:
                conn.execute("""
                UPDATE incidents
                SET end_time = ?, duration_seconds = ?, updated_at = ?
                WHERE id = ?;
                """, (video_timestamp, existing["duration_seconds"], time.strftime("%Y-%m-%d %H:%M:%S"), existing["incident_id"]))
                conn.commit()
            finally:
                conn.close()

            # Update timeline entry
            for item in self.timeline_incidents:
                if item["incident_id"] == existing["incident_id"]:
                    item["end_timestamp"] = video_timestamp
                    item["duration_seconds"] = existing["duration_seconds"]
                    break
        else:
            # Create a brand new incident event
            snap_filename = f"vid_snap_{int(time.time())}_{len(self.timeline_incidents)+1}.jpg"
            snap_path = os.path.join(SNAPSHOTS_DIR, snap_filename)
            cv2.imwrite(snap_path, frame)
            snapshot_rel = f"data/snapshots/{snap_filename}"

            now_str = time.strftime("%Y-%m-%d %H:%M:%S")
            conn = get_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                INSERT INTO incidents (
                    worker_id, worker_name, camera_id, zone, violation_type,
                    detected_ppe, missing_ppe, start_time, end_time, duration_seconds,
                    severity, identity_confidence, detection_confidence, status,
                    snapshot_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?, 'ACTIVE', ?, ?, ?);
                """, (
                    worker_id,
                    worker_name,
                    "UPLOADED_VIDEO",
                    f"{zone_name} ({self.filename})",
                    violation_summary,
                    json.dumps(detected_items),
                    json.dumps(missing_items),
                    video_timestamp,
                    video_timestamp,
                    severity,
                    identity_conf,
                    detection_conf,
                    snapshot_rel,
                    now_str,
                    now_str
                ))
                inc_id = cur.lastrowid
                conn.commit()
            finally:
                conn.close()

            # Track in active grouping dictionary
            self._active_incidents[cache_key] = {
                "incident_id": inc_id,
                "start_sec": video_sec,
                "last_seen_sec": video_sec,
                "start_timestamp": video_timestamp,
                "end_timestamp": video_timestamp,
                "duration_seconds": 1.0
            }

            # Increment count by violation type
            self.violations_by_type[violation_summary] = self.violations_by_type.get(violation_summary, 0) + 1

            # Append to timeline
            timeline_entry = {
                "incident_id": inc_id,
                "video_timestamp": video_timestamp,
                "end_timestamp": video_timestamp,
                "video_time_sec": round(video_sec, 2),
                "duration_seconds": 1.0,
                "actor_type": actor_type,
                "worker_id": worker_id,
                "worker_name": worker_name,
                "violation_type": violation_summary,
                "missing_ppe": missing_items,
                "detected_ppe": detected_items,
                "severity": severity,
                "snapshot_path": snapshot_rel,
                "created_at": now_str
            }
            self.timeline_incidents.append(timeline_entry)

    def _check_stale_active_incidents(self, current_video_sec: float):
        for key, item in list(self._active_incidents.items()):
            if current_video_sec - item["last_seen_sec"] > self.incident_continuation_window:
                # Mark as RESOLVED in DB
                conn = get_connection()
                try:
                    conn.execute("UPDATE incidents SET status = 'RESOLVED' WHERE id = ?;", (item["incident_id"],))
                    conn.commit()
                finally:
                    conn.close()
                self._active_incidents.pop(key, None)

    def _finalize_all_active_incidents(self):
        conn = get_connection()
        try:
            for key, item in self._active_incidents.items():
                conn.execute("UPDATE incidents SET status = 'RESOLVED' WHERE id = ?;", (item["incident_id"],))
            conn.commit()
        finally:
            conn.close()
        self._active_incidents.clear()

    # ------------------ DRAWING & HUD OVERLAYS ------------------ #

    def _draw_person_overlay(
        self,
        frame: np.ndarray,
        track: TrackedPerson,
        x1: int, y1: int, x2: int, y2: int,
        ppe_status: Dict[str, Any],
        violations: List[str]
    ):
        is_violation = len(violations) > 0
        is_identified = track.worker_id is not None

        # Color: Red for violation, Green for compliant, Cyan for unknown compliant
        if is_violation:
            box_color = (40, 40, 235)  # Bright Red
        elif is_identified:
            box_color = (40, 205, 70)  # Bright Green
        else:
            box_color = (255, 200, 0)  # Cyan/Amber for unknown compliant

        # Corner accents
        cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
        corner_len = min(20, (x2 - x1) // 4, (y2 - y1) // 4)
        if corner_len > 4:
            for cx, cy, dx, dy in [(x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)]:
                cv2.line(frame, (cx, cy), (cx + dx * corner_len, cy), box_color, 3)
                cv2.line(frame, (cx, cy), (cx, cy + dy * corner_len), box_color, 3)

        # Header Badge
        if is_identified:
            id_text = f"ID: {track.worker_id} - {track.worker_name}"
            bg_color = (20, 80, 20) if not is_violation else (20, 20, 100)
        else:
            id_text = "UNKNOWN PERSON"
            bg_color = (15, 60, 90) if not is_violation else (20, 20, 100)

        (tw, th), _ = cv2.getTextSize(id_text, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
        badge_y1 = max(0, y1 - 24)
        cv2.rectangle(frame, (x1, badge_y1), (x1 + tw + 14, y1), bg_color, -1)
        cv2.rectangle(frame, (x1, badge_y1), (x1 + tw + 14, y1), box_color, 1)
        cv2.putText(frame, id_text, (x1 + 6, y1 - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)

        # PPE Status Badges along side/bottom
        tag_y = y1 + 18
        for ppe_name, ppe_info in ppe_status.items():
            status_val = ppe_info.get("status", "NOT CONFIGURED")
            lbl = ppe_name.replace("_", " ").title()
            
            if status_val == "PRESENT":
                tag_str = f"+ {lbl}: OK"
                tc = (50, 230, 80)
            elif status_val == "MISSING":
                tag_str = f"! {lbl}: MISSING"
                tc = (50, 50, 245)
            elif status_val == "UNCERTAIN":
                tag_str = f"? {lbl}: UNCERTAIN"
                tc = (245, 180, 40)
            else:
                continue

            (ptw, pth), _ = cv2.getTextSize(tag_str, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            cv2.rectangle(frame, (x1 + 2, tag_y - pth - 3), (x1 + ptw + 8, tag_y + 3), (15, 20, 30), -1)
            cv2.putText(frame, tag_str, (x1 + 5, tag_y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, tc, 1, cv2.LINE_AA)
            tag_y += 18

    def _draw_hud_watermark(self, frame: np.ndarray, timestamp: str):
        # Top-left HUD Watermark
        overlay = frame.copy()
        cv2.rectangle(overlay, (12, 12), (320, 68), (11, 17, 32), -1)
        cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
        cv2.rectangle(frame, (12, 12), (320, 68), (0, 217, 255), 1)

        cv2.putText(frame, "SENTINELX AI | VIDEO ANALYSIS", (22, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 217, 255), 1, cv2.LINE_AA)
        status_color = (0, 217, 255) if self.status == "ANALYZING" else (245, 180, 40)
        cv2.putText(frame, f"STATUS: {self.status}", (22, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.45, status_color, 1, cv2.LINE_AA)
        cv2.putText(frame, f"REC TIME: {timestamp}", (160, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

video_analysis_service = VideoAnalysisService()
