import os
import sys
import logging

logger = logging.getLogger("sentinelx.paths")

def is_frozen() -> bool:
    """Returns True if running inside a PyInstaller frozen bundle."""
    return getattr(sys, "frozen", False)

def is_packaged() -> bool:
    """Returns True if running in packaged mode (frozen binary or Electron production)."""
    return is_frozen() or os.environ.get("SENTINELX_PACKAGED") == "1"

def get_project_root() -> str:
    """Returns the source project root directory."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def get_bundle_dir() -> str:
    """
    Returns the base directory for read-only static bundled resources.
    In PyInstaller, sys._MEIPASS or executable directory.
    In dev, the project root.
    """
    if is_frozen():
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return get_project_root()

def get_models_dir() -> str:
    """Resolves the models directory containing .pt and .onnx model files."""
    candidates = []
    if is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(os.path.join(meipass, "models"))
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "models"))
        candidates.append(os.path.join(exe_dir, "..", "models"))
        candidates.append(os.path.join(exe_dir, "..", "..", "models"))
    candidates.append(os.path.join(get_project_root(), "models"))
    
    for c in candidates:
        norm = os.path.abspath(c)
        if os.path.exists(norm) and os.path.isdir(norm):
            return norm
    return os.path.abspath(candidates[0])

def resolve_model_path(model_identifier: str) -> str:
    """
    Resolves a model path or filename (e.g. 'yolov8_ppe_hansung.pt' or 'models/yolov8_ppe_hansung.pt')
    to an absolute existing file path. Falls back to yolov8n.pt if requested model is missing.
    """
    if not model_identifier:
        model_identifier = "yolov8_ppe_hansung.pt"

    base_name = os.path.basename(model_identifier)
    models_dir = get_models_dir()

    # 1. Direct check in models dir
    direct = os.path.join(models_dir, base_name)
    if os.path.exists(direct):
        return direct

    # 2. Check if model_identifier is already an existing path
    if os.path.exists(model_identifier):
        return os.path.abspath(model_identifier)

    # 3. Fallback to yolov8n.pt
    fallback = os.path.join(models_dir, "yolov8n.pt")
    if os.path.exists(fallback):
        logger.warning(f"Requested model '{model_identifier}' not found. Falling back to {fallback}")
        return fallback

    return direct

def get_alarm_dir() -> str:
    """Resolves the Alarm audio directory containing industrial alarm sounds."""
    candidates = []
    if is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(os.path.join(meipass, "Alarm"))
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "Alarm"))
        candidates.append(os.path.join(exe_dir, "..", "Alarm"))
        candidates.append(os.path.join(exe_dir, "..", "..", "Alarm"))
    candidates.append(os.path.join(get_project_root(), "Alarm"))

    for c in candidates:
        norm = os.path.abspath(c)
        if os.path.exists(norm) and os.path.isdir(norm):
            return norm
    return os.path.abspath(candidates[0])

def get_app_data_dir() -> str:
    """
    Returns the persistent writable data directory for SentinelX AI.
    On Windows production/packaged: %APPDATA%\\SentinelX AI\\
    In development mode: defaults to project root unless SENTINELX_USE_APPDATA=1 or SENTINELX_DATA_DIR is set.
    """
    custom = os.environ.get("SENTINELX_DATA_DIR")
    if custom:
        return os.path.abspath(custom)

    if is_packaged() or os.environ.get("SENTINELX_USE_APPDATA") == "1":
        app_data = os.environ.get("APPDATA")
        if not app_data:
            app_data = os.path.expanduser("~")
        return os.path.abspath(os.path.join(app_data, "SentinelX AI"))

    # Development fallback: use local workspace root
    return get_project_root()

# Persistent dynamic paths
APP_DATA_DIR = get_app_data_dir()
DB_PATH = os.path.join(APP_DATA_DIR, "sentinelx.db")
ADMIN_DB_PATH = os.path.join(APP_DATA_DIR, "sentinelx_admin.db")
LICENSE_FILE_PATH = os.path.join(APP_DATA_DIR, "sentinelx_license.json")
STATION_LEASE_FILE_PATH = os.path.join(APP_DATA_DIR, "sentinelx_lease.json")
ADMIN_SECRET_FILE = os.path.join(APP_DATA_DIR, ".admin_signing_key")
DATA_DIR = os.path.join(APP_DATA_DIR, "data")
PHOTOS_DIR = os.path.join(DATA_DIR, "photos")
QRCODES_DIR = os.path.join(DATA_DIR, "qrcodes")
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
TEST_VIDEOS_DIR = os.path.join(DATA_DIR, "test_videos")
YOLO_CONFIG_DIR = os.path.join(APP_DATA_DIR, "yolo_config")
try:
    os.makedirs(os.path.join(YOLO_CONFIG_DIR, "Ultralytics"), exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = YOLO_CONFIG_DIR
except Exception:
    pass

def ensure_data_directories():
    """Safely creates all required writable data directories."""
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    os.makedirs(QRCODES_DIR, exist_ok=True)
    os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(TEST_VIDEOS_DIR, exist_ok=True)
    yolo_dir = os.path.join(APP_DATA_DIR, "yolo_config")
    os.makedirs(yolo_dir, exist_ok=True)
    os.makedirs(os.path.join(yolo_dir, "Ultralytics"), exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = yolo_dir

def get_frontend_dist_dir() -> str:
    """Locates the built frontend production directory."""
    candidates = []
    if is_frozen():
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "_internal", "frontend", "dist"))
        candidates.append(os.path.join(exe_dir, "frontend", "dist"))
        candidates.append(os.path.join(exe_dir, "..", "frontend", "dist"))
        candidates.append(os.path.join(exe_dir, "..", "app", "frontend", "dist"))
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(os.path.join(meipass, "frontend", "dist"))
    
    root = get_project_root()
    candidates.append(os.path.join(root, "frontend", "dist"))
    candidates.append(os.path.join(root, "dist"))

    for c in candidates:
        norm = os.path.abspath(c)
        if os.path.exists(norm) and os.path.exists(os.path.join(norm, "index.html")):
            return norm
    return os.path.abspath(candidates[0])
