from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class WorkerCreate(BaseModel):
    worker_id: str
    name: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    department: str
    designation: str
    shift: str
    joining_date: Optional[str] = ""
    required_ppe: List[str] = ["helmet", "safety_vest"]
    status: Optional[str] = "ACTIVE"
    photo_base64: Optional[str] = None
    overwrite: Optional[bool] = False

class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    shift: Optional[str] = None
    required_ppe: Optional[List[str]] = None
    status: Optional[str] = None
    photo_base64: Optional[str] = None

class CameraCreate(BaseModel):
    camera_id: str
    name: str
    zone: str = "Welding Area"
    input_type: str = "webcam"
    source_uri: str = "0"
    resolution: str = "1280x720"

class CameraStartRequest(BaseModel):
    camera_id: Optional[str] = "CAM-01"
    source: str = "0"
    source_type: str = "webcam"
    conf_thresh: float = 0.35
    model_choice: str = "hansung"

class ConfigUpdateRequest(BaseModel):
    detection_confidence: Optional[float] = None
    identity_confidence_threshold: Optional[float] = None
    sound_alerts_enabled: Optional[bool] = None
    alert_volume: Optional[float] = None
    alert_cooldown_seconds: Optional[int] = None
    active_model: Optional[str] = None

class AlertUpdateRequest(BaseModel):
    status: str

class QRScanRequest(BaseModel):
    image_base64: Optional[str] = None
    qr_text: Optional[str] = None

class VideoAnalysisStartRequest(BaseModel):
    file_path: str
    model_choice: Optional[str] = "hansung"
    conf_thresh: Optional[float] = 0.35
    identity_thresh: Optional[float] = 0.45
    required_ppe: Optional[List[str]] = ["helmet", "safety_vest"]
    frame_step: Optional[int] = 3
    zone_name: Optional[str] = "Recorded Video"

