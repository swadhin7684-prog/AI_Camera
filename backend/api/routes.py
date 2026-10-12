import os
import cv2
import time
import json
import base64
import qrcode
import numpy as np
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse

from backend.database.db import (
    get_all_workers, get_worker_by_id, get_worker_by_qr, create_worker,
    update_worker, delete_worker, save_worker_embedding,
    get_all_cameras, add_camera, delete_camera,
    get_all_zones, get_incidents, get_incident_by_id,
    get_alerts, update_alert_status, get_analytics_metrics,
    get_settings, update_setting, seed_demo_workers,
    delete_incident, delete_all_incidents, delete_alert,
    delete_all_alerts, cleanup_expired_data, get_storage_stats,
    get_all_video_analyses, get_video_analysis, delete_video_analysis
)
from backend.models.schemas import (
    WorkerCreate, WorkerUpdate, CameraCreate, CameraStartRequest,
    ConfigUpdateRequest, AlertUpdateRequest, QRScanRequest,
    VideoAnalysisStartRequest
)
import logging
from backend.services.camera_service import camera_service
from backend.services.video_analysis_service import video_analysis_service


logger = logging.getLogger("sentinelx.routes")

router = APIRouter(prefix="/api")

from backend.paths import (
    DATA_DIR,
    PHOTOS_DIR,
    QRCODES_DIR,
    SNAPSHOTS_DIR,
    UPLOADS_DIR,
    get_alarm_dir,
    ensure_data_directories
)

ensure_data_directories()

# ----------------- HEALTH ROUTE ----------------- #

@router.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {
        "status": "online",
        "service": "SENTINELX AI Industrial Safety",
        "version": "1.1.0",
        "camera_active": camera_service.is_active,
        "model_loaded": camera_service.detector is not None,
        "face_engine_ready": camera_service.face_engine.is_ready
    }

ALARM_DIR = get_alarm_dir()

def get_current_alarm_file():
    if not os.path.exists(ALARM_DIR):
        return None
    files = [f for f in os.listdir(ALARM_DIR) if not f.startswith('.')]
    audio_files = [f for f in files if f.lower().endswith(('.mpeg', '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'))]
    if audio_files:
        return os.path.join(ALARM_DIR, audio_files[0])
    if files:
        return os.path.join(ALARM_DIR, files[0])
    return None

@router.api_route("/alarm-audio", methods=["GET", "HEAD"])
def get_alarm_audio():
    file_path = get_current_alarm_file()
    if file_path and os.path.exists(file_path):
        ext = os.path.splitext(file_path)[1].lower()
        media_type = "audio/mpeg"
        if ext == ".wav":
            media_type = "audio/wav"
        elif ext == ".ogg":
            media_type = "audio/ogg"
        elif ext in [".m4a", ".mp4"]:
            media_type = "audio/mp4"
        return FileResponse(file_path, media_type=media_type, filename=os.path.basename(file_path))
    raise HTTPException(status_code=404, detail="No alarm file found in Alarm folder")

@router.get("/alarm-info")
def get_alarm_info():
    file_path = get_current_alarm_file()
    if file_path and os.path.exists(file_path):
        return {"filename": os.path.basename(file_path), "size": os.path.getsize(file_path), "exists": True}
    return {"filename": None, "size": 0, "exists": False}

# ----------------- WORKER ROUTES ----------------- #

@router.get("/workers")
def list_workers(search: Optional[str] = None, department: Optional[str] = None, status: Optional[str] = None):
    return {"workers": get_all_workers(search, department, status)}

@router.get("/workers/{worker_id}")
def get_worker(worker_id: str):
    w = get_worker_by_id(worker_id)
    if not w:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    # Attach worker-specific violation stats from actual incidents
    incidents = get_incidents(limit=20, worker_id=worker_id)
    w["recent_incidents"] = incidents
    w["total_violations"] = len(incidents)
    return {"worker": w}

@router.post("/workers")
def register_worker(worker: WorkerCreate):
    existing = get_worker_by_id(worker.worker_id)
    if existing and not worker.overwrite:
        owner_name = existing.get("name", "Unknown")
        raise HTTPException(
            status_code=400,
            detail=f"Worker ID '{worker.worker_id}' is already registered to '{owner_name}'. You can update this profile or use a different Worker ID."
        )

    qr_id = f"SENTINELX-ID-{worker.worker_id}"
    qr_filename = f"{worker.worker_id}_qr.png"
    qr_path = os.path.join(QRCODES_DIR, qr_filename)

    # 1. Generate QR Code
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(qr_id)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    qr_img.save(qr_path)

    photo_rel_path = existing.get("photo_path", "") if existing else ""
    img = None
    face_enrolled = False
    quality_info = None

    # 2. Process photo & extract face embedding if base64 provided
    if worker.photo_base64:
        try:
            b64_data = worker.photo_base64
            if "," in b64_data:
                b64_data = b64_data.split(",")[1]
            img_bytes = base64.b64decode(b64_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                raise HTTPException(status_code=400, detail="Invalid photo data: could not decode image.")

            # Validate face detection and quality
            face_pass, face_row, quality_info = camera_service.face_engine.detect_face(img)
            if face_row is None:
                raise HTTPException(
                    status_code=400,
                    detail="Face Enrollment Failed: No human face detected in the photo. Please capture a clear, forward-facing photo."
                )

            if not face_pass:
                reasons = ", ".join(quality_info.get("reasons", ["Face quality insufficient"]))
                raise HTTPException(
                    status_code=400,
                    detail=f"Face Quality Check Failed: {reasons}. Please retake with better lighting and alignment."
                )

            # Generate 128-d biometric embedding
            emb = camera_service.face_engine.extract_embedding(img, face_row)
            if emb is None:
                raise HTTPException(
                    status_code=500,
                    detail="Face Recognition Engine failed to generate feature embedding."
                )

            photo_filename = f"{worker.worker_id}.jpg"
            photo_abs_path = os.path.join(PHOTOS_DIR, photo_filename)
            cv2.imwrite(photo_abs_path, img)
            photo_rel_path = f"data/photos/{photo_filename}"
            face_enrolled = True

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error processing photo for {worker.worker_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Error processing photo: {str(e)}")

    worker_dict = worker.model_dump(exclude={"overwrite"})
    worker_dict["qr_identifier"] = qr_id
    if photo_rel_path:
        worker_dict["photo_path"] = photo_rel_path

    if existing:
        saved_worker = update_worker(worker.worker_id, worker_dict)
    else:
        saved_worker = create_worker(worker_dict)

    # 3. Save Face Embedding associated with Worker ID
    if face_enrolled and img is not None and face_row is not None and emb is not None:
        save_worker_embedding(worker.worker_id, emb.tobytes(), quality_score=float(face_row[-1]))
        logger.info(f"Successfully saved biometric face embedding for worker {worker.worker_id}")

    # Refresh in-memory worker gallery immediately
    camera_service.refresh_worker_gallery()
    return {
        "status": "success",
        "worker": saved_worker,
        "updated": bool(existing),
        "face_enrolled": face_enrolled,
        "quality_info": quality_info
    }

@router.put("/workers/{worker_id}")
def edit_worker(worker_id: str, updates: WorkerUpdate):
    existing = get_worker_by_id(worker_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Worker not found")

    update_data = updates.model_dump(exclude_unset=True)
    photo_b64 = update_data.pop("photo_base64", None)
    face_enrolled = False

    if photo_b64:
        try:
            b64_str = photo_b64
            if "," in b64_str:
                b64_str = b64_str.split(",")[1]
            img_bytes = base64.b64decode(b64_str)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is not None:
                face_pass, face_row, quality_info = camera_service.face_engine.detect_face(img)
                if face_row is not None and face_pass:
                    emb = camera_service.face_engine.extract_embedding(img, face_row)
                    if emb is not None:
                        photo_filename = f"{worker_id}.jpg"
                        photo_disk_path = os.path.join(PHOTOS_DIR, photo_filename)
                        cv2.imwrite(photo_disk_path, img)
                        update_data["photo_path"] = f"data/photos/{photo_filename}"
                        save_worker_embedding(worker_id, emb.tobytes(), quality_score=float(face_row[-1]))
                        face_enrolled = True
                        logger.info(f"Updated biometric face embedding for worker {worker_id}")
                else:
                    reasons = ", ".join(quality_info.get("reasons", ["No clear face detected"]))
                    raise HTTPException(status_code=400, detail=f"Face Enrollment Failed: {reasons}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to update photo/face for {worker_id}: {e}")
            raise HTTPException(status_code=400, detail=f"Error updating photo: {str(e)}")

    w = update_worker(worker_id, update_data)
    if not w:
        raise HTTPException(status_code=404, detail="Worker not found")
    camera_service.refresh_worker_gallery()
    return {"status": "success", "worker": w, "face_enrolled": face_enrolled}

@router.delete("/workers/{worker_id}")
def remove_worker(worker_id: str):
    success = delete_worker(worker_id)
    if not success:
        raise HTTPException(status_code=404, detail="Worker not found")
    camera_service.refresh_worker_gallery()
    return {"status": "success", "deleted": worker_id}

@router.get("/workers/{worker_id}/qr")
def download_worker_qr(worker_id: str):
    qr_filename = f"{worker_id}_qr.png"
    qr_path = os.path.join(QRCODES_DIR, qr_filename)
    if not os.path.exists(qr_path):
        # Generate on demand
        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(f"SENTINELX-ID-{worker_id}")
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white")
        qr_img.save(qr_path)
    return FileResponse(qr_path, media_type="image/png", filename=f"Worker_{worker_id}_QR.png")

@router.post("/workers/validate-face")
def validate_face_image(data: Dict[str, str]):
    """Validates face in base64 image during worker registration."""
    b64_data = data.get("image_base64", "")
    if "," in b64_data:
        b64_data = b64_data.split(",")[1]
    try:
        img_bytes = base64.b64decode(b64_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"valid": False, "error": "Invalid image format"}

        face_pass, face_row, quality_info = camera_service.face_engine.detect_face(img)
        return {
            "valid": face_pass,
            "quality_info": quality_info,
            "has_face": face_row is not None
        }
    except Exception as e:
        return {"valid": False, "error": str(e)}

# ----------------- QR SCANNER ROUTES ----------------- #

@router.post("/qr/scan")
def scan_qr_code(req: QRScanRequest):
    """Scans and decodes QR code using OpenCV QRCodeDetector."""
    qr_text = req.qr_text

    if not qr_text and req.image_base64:
        b64 = req.image_base64
        if "," in b64:
            b64 = b64.split(",")[1]
        img_bytes = base64.b64decode(b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is not None:
            detector = cv2.QRCodeDetector()
            val, points, _ = detector.detectAndDecode(frame)
            if val:
                qr_text = val

    if not qr_text:
        return {"status": "error", "message": "No QR code could be detected in the provided image"}

    # Look up worker by QR identifier
    worker = get_worker_by_qr(qr_text)
    if not worker:
        # Also check if it's formatted as Worker ID directly (e.g. W-001)
        if qr_text.startswith("SENTINELX-ID-"):
            clean_id = qr_text.replace("SENTINELX-ID-", "")
            worker = get_worker_by_id(clean_id)
        else:
            worker = get_worker_by_id(qr_text)

    if not worker:
        return {"status": "not_found", "qr_text": qr_text, "message": f"Worker with QR '{qr_text}' is not registered."}

    incidents = get_incidents(limit=10, worker_id=worker["worker_id"])
    worker["recent_incidents"] = incidents
    worker["total_violations"] = len(incidents)

    return {"status": "success", "worker": worker}

# ----------------- CAMERA ROUTES ----------------- #

@router.get("/cameras")
def list_cameras():
    return {"cameras": get_all_cameras()}

_cached_available_cameras = None

@router.get("/cameras/available")
def list_available_hardware():
    global _cached_available_cameras
    if _cached_available_cameras is not None:
        return {"available": _cached_available_cameras}

    cameras = []
    # Probe hardware only once and never while camera is streaming to prevent DShow crashes
    if not camera_service.is_active:
        for idx in range(2):
            try:
                cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        h, w = frame.shape[:2]
                        cameras.append({
                            "index": str(idx),
                            "name": f"Camera {idx} (Built-in / USB Camera)",
                            "resolution": f"{w}x{h}"
                        })
                    cap.release()
            except Exception:
                pass

    if not cameras:
        cameras.append({
            "index": "0",
            "name": "Camera 0 (Built-in / USB Camera)",
            "resolution": "1280x720"
        })
    _cached_available_cameras = cameras
    return {"available": cameras}

@router.post("/cameras/start")
def start_camera_stream(req: CameraStartRequest):
    res = camera_service.start_camera(
        camera_id=req.camera_id or "CAM-01",
        camera_name="Live Production Stream",
        zone="Welding Area",
        source=req.source,
        source_type=req.source_type,
        conf_thresh=req.conf_thresh,
        model_choice=req.model_choice
    )
    return res

@router.post("/cameras/stop")
async def stop_camera_stream():
    camera_service.stop_camera()
    try:
        await camera_service.broadcast_ws()
    except Exception:
        pass
    return {"status": "stopped"}

def create_standby_frame():
    standby = np.zeros((720, 1280, 3), dtype=np.uint8)
    standby[:] = (15, 23, 42)  # Dark slate background
    # Subtle grid
    for y in range(0, 720, 40):
        cv2.line(standby, (0, y), (1280, y), (23, 32, 51), 1)
    for x in range(0, 1280, 40):
        cv2.line(standby, (x, 0), (x, 720), (23, 32, 51), 1)
    cv2.putText(standby, "SENTINELX AI - CAMERA STANDBY", (420, 340), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 217, 255), 2)
    cv2.putText(standby, "Feed is currently stopped. Click 'Start Camera' to resume.", (350, 385), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (148, 163, 184), 1)
    _, buf = cv2.imencode(".jpg", standby, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    return buf.tobytes()

_standby_bytes = None

def gen_mjpeg_stream():
    global _standby_bytes
    if _standby_bytes is None:
        _standby_bytes = create_standby_frame()

    target_interval = 1.0 / 60.0  # 60 FPS target interval (~0.0166s)

    while True:
        t_start = time.time()
        if not camera_service.is_active:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + _standby_bytes + b'\r\n')
            time.sleep(0.05)
            continue

        try:
            annotated = camera_service.process_current_frame()
            frame_bytes = camera_service.last_frame_bytes
        except Exception as e:
            logger.error(f"Error in process_current_frame: {e}")
            frame_bytes = _standby_bytes

        if frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        else:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + _standby_bytes + b'\r\n')

        elapsed = time.time() - t_start
        sleep_dur = max(0.001, target_interval - elapsed)
        time.sleep(sleep_dur)  # Locked 60 FPS stream loop

@router.get("/video-feed")
def video_feed():
    return StreamingResponse(
        gen_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/detections")
def get_live_detections():
    return camera_service.get_detections_payload()

# ----------------- INCIDENTS & ALERTS ROUTES ----------------- #

@router.get("/incidents")
def list_incidents(
    limit: int = 100,
    worker_id: Optional[str] = None,
    department: Optional[str] = None,
    camera_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None
):
    return {"incidents": get_incidents(limit, worker_id, department, camera_id, severity, status)}

@router.get("/incidents/{incident_id}")
def get_incident(incident_id: int):
    inc = get_incident_by_id(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"incident": inc}

@router.delete("/incidents/{incident_id}")
def remove_incident(incident_id: int):
    success = delete_incident(incident_id)
    if not success:
        raise HTTPException(status_code=404, detail="Incident not found or already deleted")
    return {"status": "success", "deleted_id": incident_id}

@router.delete("/incidents")
def remove_all_incidents():
    stats = delete_all_incidents()
    return {"status": "success", "message": "All incidents and snapshot evidence deleted.", "stats": stats}

@router.get("/alerts")
def list_alerts(limit: int = 50, status: Optional[str] = None):
    return {"alerts": get_alerts(limit, status)}

@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: int, req: AlertUpdateRequest):
    success = update_alert_status(alert_id, req.status)
    return {"status": "success", "updated": success}

@router.delete("/alerts/{alert_id}")
def remove_alert(alert_id: int):
    success = delete_alert(alert_id)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found or already deleted")
    return {"status": "success", "deleted_id": alert_id}

@router.delete("/alerts")
def remove_all_alerts():
    count = delete_all_alerts()
    return {"status": "success", "message": f"{count} alerts deleted successfully.", "deleted_count": count}

# ----------------- STORAGE & FIFO AUTO-PURGE ROUTES ----------------- #

@router.get("/storage-stats")
def storage_stats():
    return {"storage": get_storage_stats()}

@router.post("/cleanup")
def run_fifo_cleanup(retention_hours: float = Query(24.0, ge=0.1, le=720.0), max_fifo_records: int = Query(500, ge=10, le=5000)):
    result = cleanup_expired_data(retention_hours=retention_hours, max_fifo_records=max_fifo_records)
    return {
        "status": "success",
        "message": f"FIFO cleanup executed for {retention_hours}h retention.",
        "purged": result,
        "current_storage": get_storage_stats()
    }

# ----------------- ANALYTICS & SETTINGS ROUTES ----------------- #

@router.get("/analytics")
def get_analytics():
    return {"analytics": get_analytics_metrics()}

@router.get("/settings")
def read_settings():
    settings = get_settings()
    # Add runtime model information
    model_info = {
        "loaded_model": camera_service.model_choice,
        "model_file": camera_service.detector.model_path if camera_service.detector else "",
        "supported_classes": camera_service.detector.supported_canonical if camera_service.detector else [],
        "unsupported_classes": camera_service.detector.unsupported_canonical if camera_service.detector else [],
        "detection_confidence": camera_service.conf_thresh,
        "identity_threshold": camera_service.identity_thresh,
        "face_engine_ready": camera_service.face_engine.is_ready
    }
    return {"settings": settings, "model_info": model_info}

@router.post("/settings")
def save_settings(config: ConfigUpdateRequest):
    if config.detection_confidence is not None:
        update_setting("detection_confidence", str(config.detection_confidence))
        camera_service.conf_thresh = config.detection_confidence
        if camera_service.detector:
            camera_service.detector.conf_thresh = config.detection_confidence

    if config.identity_confidence_threshold is not None:
        update_setting("identity_confidence_threshold", str(config.identity_confidence_threshold))
        camera_service.identity_thresh = config.identity_confidence_threshold

    if config.sound_alerts_enabled is not None:
        update_setting("sound_alerts_enabled", "true" if config.sound_alerts_enabled else "false")
        camera_service.sound_enabled = config.sound_alerts_enabled

    if config.alert_volume is not None:
        update_setting("alert_volume", str(config.alert_volume))

    if config.alert_cooldown_seconds is not None:
        update_setting("alert_cooldown_seconds", str(config.alert_cooldown_seconds))
        camera_service.alert_cooldown = float(config.alert_cooldown_seconds)

    if config.active_model is not None:
        update_setting("active_model", config.active_model)
        camera_service.init_detector(config.active_model)

    return {"status": "success", "settings": get_settings()}

@router.post("/demo/seed")
def seed_demo_data():
    seed_demo_workers()
    camera_service.refresh_worker_gallery()
    return {"status": "success", "message": "Demo workers seeded successfully with label DEMO DATA."}

# ----------------- RECORDED VIDEO ANALYSIS ROUTES ----------------- #

UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

@router.post("/video-analysis/upload")
async def upload_recorded_video(file: UploadFile = File(...)):
    """Uploads a workplace/factory recorded video file and returns extracted metadata."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No video file provided.")

    allowed_exts = {".mp4", ".avi", ".mov", ".mkv"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format '{ext}'. Supported formats: {', '.join(allowed_exts)}"
        )

    # Sanitize and create unique file path to prevent overwriting
    safe_base = "".join(c for c in os.path.basename(file.filename) if c.isalnum() or c in "._- ")
    timestamp_prefix = int(time.time())
    dest_filename = f"{timestamp_prefix}_{safe_base}"
    dest_path = os.path.join(UPLOADS_DIR, dest_filename)

    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes).")
        with open(dest_path, "wb") as f:
            f.write(content)
    except Exception as e:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=500, detail=f"Failed to save video: {str(e)}")

    # Validate readability and extract metadata using OpenCV
    try:
        metadata = video_analysis_service.validate_and_get_metadata(dest_path)
        # Store relative path for cleaner frontend referencing
        metadata["relative_path"] = f"data/uploads/{dest_filename}"
        return {"status": "success", "metadata": metadata}
    except Exception as e:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail=f"Invalid or corrupted video file: {str(e)}")

@router.get("/video-analysis/video-file")
def get_uploaded_video_file(path: str = Query(..., description="Path to uploaded video file")):
    """Serves the uploaded video file for browser playback and preview."""
    # Resolve absolute path safely
    if not os.path.isabs(path):
        resolved_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", path))
    else:
        resolved_path = os.path.abspath(path)

    # Security check: must reside inside data dir or workspace
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if not resolved_path.startswith(workspace_root) or not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="Video file not found or access denied.")

    ext = os.path.splitext(resolved_path)[1].lower()
    media_type = "video/mp4"
    if ext == ".avi":
        media_type = "video/x-msvideo"
    elif ext == ".mov":
        media_type = "video/quicktime"
    elif ext == ".mkv":
        media_type = "video/x-matroska"

    return FileResponse(resolved_path, media_type=media_type, filename=os.path.basename(resolved_path))

@router.post("/video-analysis/start")
def start_video_analysis(req: VideoAnalysisStartRequest):
    """Starts AI safety analysis on the uploaded video."""
    target_path = req.file_path
    if not os.path.isabs(target_path):
        target_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", target_path))

    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.file_path}")

    try:
        result = video_analysis_service.start_analysis(
            file_path=target_path,
            model_choice=req.model_choice or "hansung",
            conf_thresh=req.conf_thresh or 0.35,
            identity_thresh=req.identity_thresh or 0.45,
            required_ppe=req.required_ppe or ["helmet", "safety_vest"],
            frame_step=max(1, req.frame_step or 3),
            zone_name=req.zone_name or "Recorded Video"
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/video-analysis/pause")
def pause_video_analysis():
    """Pauses the ongoing video analysis."""
    return video_analysis_service.pause_analysis()

@router.post("/video-analysis/resume")
def resume_video_analysis():
    """Resumes the paused video analysis."""
    return video_analysis_service.resume_analysis()

@router.post("/video-analysis/cancel")
def cancel_video_analysis():
    """Cancels/stops the ongoing video analysis."""
    return video_analysis_service.cancel_analysis()

@router.get("/video-analysis/status")
def get_video_analysis_status():
    """Returns real-time processing telemetry, progress, and detection metrics."""
    return video_analysis_service.get_status_payload()

@router.get("/video-analysis/results")
def get_video_analysis_results():
    """Returns full summary and timestamped incident timeline."""
    return video_analysis_service.get_results_summary()

@router.get("/video-analysis/preview-frame")
def get_video_analysis_preview_frame():
    """Returns the latest annotated video frame with AI overlay."""
    jpeg_bytes = video_analysis_service.get_latest_frame_jpeg()
    if not jpeg_bytes:
        # Return fallback standby image
        standby = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(standby, "SENTINELX AI - READY TO ANALYZE", (80, 240),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 217, 255), 2)
        _, buf = cv2.imencode(".jpg", standby)
        jpeg_bytes = buf.tobytes()

    from fastapi import Response
    return Response(content=jpeg_bytes, media_type="image/jpeg")

def gen_analysis_preview_mjpeg():
    """Generator for streaming live annotated video analysis frames."""
    standby = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(standby, "SENTINELX AI - VIDEO ANALYSIS STANDBY", (70, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 217, 255), 2)
    _, buf = cv2.imencode(".jpg", standby)
    standby_bytes = buf.tobytes()

    while True:
        jpeg_bytes = video_analysis_service.get_latest_frame_jpeg()
        frame_bytes = jpeg_bytes if jpeg_bytes else standby_bytes
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.066)  # ~15 FPS stream for UI preview

@router.get("/video-analysis/preview-stream")
def get_video_analysis_stream():
    """MJPEG stream of the currently processing video frame with AI overlays."""
    return StreamingResponse(
        gen_analysis_preview_mjpeg(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/video-analysis/history")
def list_video_analysis_history(limit: int = 50):
    """Returns historical video analysis sessions."""
    return {"history": get_all_video_analyses(limit=limit)}

@router.delete("/video-analysis/history/{analysis_id}")
def remove_video_analysis_record(analysis_id: int):
    """Deletes a historical video analysis record."""
    success = delete_video_analysis(analysis_id)
    if not success:
        raise HTTPException(status_code=404, detail="Analysis record not found.")
    return {"status": "success", "deleted_id": analysis_id}

