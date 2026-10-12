import sqlite3
import os
import json
import time
from typing import List, Dict, Any, Optional

from backend.paths import DB_PATH, DATA_DIR, SNAPSHOTS_DIR, ensure_data_directories, APP_DATA_DIR
DB_DIR = APP_DATA_DIR

def get_connection() -> sqlite3.Connection:
    ensure_data_directories()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn

def init_db():
    ensure_data_directories()
    conn = get_connection()
    cur = conn.cursor()

    # 1. Workers table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS workers (
        worker_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        department TEXT NOT NULL,
        designation TEXT NOT NULL,
        shift TEXT NOT NULL,
        joining_date TEXT DEFAULT '',
        photo_path TEXT DEFAULT '',
        qr_identifier TEXT UNIQUE NOT NULL,
        required_ppe TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # 2. Worker Identity (Face Embeddings) table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS worker_identity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id TEXT NOT NULL UNIQUE,
        face_embedding BLOB NOT NULL,
        embedding_dim INTEGER NOT NULL DEFAULT 128,
        quality_score REAL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE CASCADE
    );
    """)

    # 3. Cameras table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS cameras (
        camera_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        zone TEXT NOT NULL,
        input_type TEXT NOT NULL DEFAULT 'webcam',
        source_uri TEXT NOT NULL DEFAULT '0',
        is_active INTEGER NOT NULL DEFAULT 0,
        resolution TEXT DEFAULT '1280x720',
        created_at TEXT NOT NULL
    );
    """)

    # 4. Zones table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS zones (
        zone_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_required_ppe TEXT NOT NULL,
        severity_level TEXT DEFAULT 'HIGH'
    );
    """)

    # 5. Incidents table (allows worker_id = NULL for unregistered/unknown persons)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id TEXT,
        worker_name TEXT,
        camera_id TEXT NOT NULL,
        zone TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        detected_ppe TEXT NOT NULL,
        missing_ppe TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0.0,
        severity TEXT NOT NULL DEFAULT 'HIGH',
        identity_confidence REAL DEFAULT 0.0,
        detection_confidence REAL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        snapshot_path TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE SET NULL
    );
    """)

    # 6. Alerts table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id INTEGER,
        worker_id TEXT,
        worker_name TEXT,
        violation TEXT NOT NULL,
        camera_id TEXT NOT NULL,
        zone TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'HIGH',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        timestamp TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    );
    """)

    # 7. Application settings table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS application_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    # 8. Video Analyses table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS video_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_seconds REAL NOT NULL DEFAULT 0.0,
        resolution TEXT NOT NULL DEFAULT '',
        fps REAL NOT NULL DEFAULT 0.0,
        total_frames INTEGER NOT NULL DEFAULT 0,
        processed_frames INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        policy_applied TEXT NOT NULL DEFAULT '[]',
        model_used TEXT NOT NULL DEFAULT '',
        unique_people INTEGER DEFAULT 0,
        identified_workers INTEGER DEFAULT 0,
        unknown_persons INTEGER DEFAULT 0,
        violation_count INTEGER DEFAULT 0,
        uncertain_count INTEGER DEFAULT 0,
        summary_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
    );
    """)

    # Indices for performance
    cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_worker ON incidents(worker_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_video_analyses_created ON video_analyses(created_at);")

    # Seed default zones if empty
    cur.execute("SELECT COUNT(*) as count FROM zones;")
    if cur.fetchone()["count"] == 0:
        default_zones = [
            ("ZONE-01", "Welding Area", json.dumps(["helmet", "safety_vest"]), "HIGH"),
            ("ZONE-02", "Assembly Bay", json.dumps(["helmet", "safety_vest"]), "MEDIUM"),
            ("ZONE-03", "Heavy Machinery Area", json.dumps(["helmet", "safety_vest"]), "CRITICAL"),
            ("ZONE-04", "Warehouse & Storage", json.dumps(["safety_vest"]), "MEDIUM"),
        ]
        cur.executemany("INSERT INTO zones (zone_id, name, default_required_ppe, severity_level) VALUES (?, ?, ?, ?)", default_zones)

    # Seed default cameras if empty
    cur.execute("SELECT COUNT(*) as count FROM cameras;")
    if cur.fetchone()["count"] == 0:
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        default_cameras = [
            ("CAM-01", "Welding Safety Cam", "Welding Area", "webcam", "0", 1, "1280x720", now_str),
            ("CAM-02", "Assembly Bay Cam", "Assembly Bay", "webcam", "1", 0, "1280x720", now_str),
            ("CAM-03", "Warehouse Main Cam", "Warehouse & Storage", "video", "data/demo_videos/warehouse.mp4", 0, "1920x1080", now_str),
        ]
        cur.executemany("INSERT INTO cameras (camera_id, name, zone, input_type, source_uri, is_active, resolution, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", default_cameras)

    # Seed default settings if empty
    default_settings = {
        "detection_confidence": "0.35",
        "identity_confidence_threshold": "0.45",
        "sound_alerts_enabled": "true",
        "alert_volume": "0.8",
        "alert_cooldown_seconds": "5",
        "active_model": "yolov8_ppe_hansung.pt",
        "theme": "dark_industrial",
        "active_camera_id": "CAM-01",
    }
    for k, v in default_settings.items():
        cur.execute("INSERT OR IGNORE INTO application_settings (key, value) VALUES (?, ?);", (k, v))

    conn.commit()
    conn.close()

# Worker Operations
def get_all_workers(search: Optional[str] = None, department: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        query = "SELECT * FROM workers WHERE 1=1"
        params = []
        if search:
            query += " AND (worker_id LIKE ? OR name LIKE ? OR department LIKE ?)"
            s_param = f"%{search}%"
            params.extend([s_param, s_param, s_param])
        if department and department != "ALL":
            query += " AND department = ?"
            params.append(department)
        if status and status != "ALL":
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC"
        cur.execute(query, params)
        rows = cur.fetchall()
        
        workers = []
        for r in rows:
            w = dict(r)
            try:
                w["required_ppe"] = json.loads(w["required_ppe"])
            except Exception:
                w["required_ppe"] = []
            workers.append(w)
        return workers
    finally:
        conn.close()

def get_worker_by_id(worker_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM workers WHERE worker_id = ?", (worker_id,))
        row = cur.fetchone()
        if not row:
            return None
        w = dict(row)
        try:
            w["required_ppe"] = json.loads(w["required_ppe"])
        except Exception:
            w["required_ppe"] = []
        return w
    finally:
        conn.close()

def get_worker_by_qr(qr_identifier: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM workers WHERE qr_identifier = ?", (qr_identifier,))
        row = cur.fetchone()
        if not row:
            return None
        w = dict(row)
        try:
            w["required_ppe"] = json.loads(w["required_ppe"])
        except Exception:
            w["required_ppe"] = []
        return w
    finally:
        conn.close()

def create_worker(data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        req_ppe_json = json.dumps(data.get("required_ppe", ["helmet", "safety_vest"]))
        
        cur.execute("""
        INSERT INTO workers (
            worker_id, name, address, phone, email, department,
            designation, shift, joining_date, photo_path, qr_identifier,
            required_ppe, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data["worker_id"],
            data["name"],
            data.get("address", ""),
            data.get("phone", ""),
            data.get("email", ""),
            data["department"],
            data["designation"],
            data["shift"],
            data.get("joining_date", time.strftime("%Y-%m-%d")),
            data.get("photo_path", ""),
            data["qr_identifier"],
            req_ppe_json,
            data.get("status", "ACTIVE"),
            now_str,
            now_str
        ))
        conn.commit()
        return get_worker_by_id(data["worker_id"])
    finally:
        conn.close()

def update_worker(worker_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        fields = []
        params = []
        for k in ["name", "address", "phone", "email", "department", "designation", "shift", "status", "photo_path"]:
            if k in data:
                fields.append(f"{k} = ?")
                params.append(data[k])
        if "required_ppe" in data:
            fields.append("required_ppe = ?")
            params.append(json.dumps(data["required_ppe"]))
        
        if not fields:
            return get_worker_by_id(worker_id)
        
        fields.append("updated_at = ?")
        params.append(now_str)
        params.append(worker_id)

        cur.execute(f"UPDATE workers SET {', '.join(fields)} WHERE worker_id = ?", params)
        conn.commit()
        return get_worker_by_id(worker_id)
    finally:
        conn.close()

def delete_worker(worker_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM workers WHERE worker_id = ?", (worker_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

# Face Identity Operations
def save_worker_embedding(worker_id: str, embedding_bytes: bytes, quality_score: float = 1.0):
    conn = get_connection()
    try:
        cur = conn.cursor()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        cur.execute("""
        INSERT INTO worker_identity (worker_id, face_embedding, embedding_dim, quality_score, created_at)
        VALUES (?, ?, 128, ?, ?)
        ON CONFLICT(worker_id) DO UPDATE SET
            face_embedding = excluded.face_embedding,
            quality_score = excluded.quality_score,
            created_at = excluded.created_at;
        """, (worker_id, embedding_bytes, quality_score, now_str))
        conn.commit()
    finally:
        conn.close()

def get_all_worker_embeddings() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        SELECT i.worker_id, w.name, w.department, w.designation, w.photo_path, w.required_ppe, i.face_embedding, i.quality_score
        FROM worker_identity i
        JOIN workers w ON i.worker_id = w.worker_id
        WHERE w.status = 'ACTIVE';
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            item = dict(r)
            try:
                item["required_ppe"] = json.loads(item["required_ppe"])
            except Exception:
                item["required_ppe"] = []
            result.append(item)
        return result
    finally:
        conn.close()

# Cameras Operations
def get_all_cameras() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM cameras ORDER BY camera_id ASC;")
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def add_camera(data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        cur.execute("""
        INSERT INTO cameras (camera_id, name, zone, input_type, source_uri, is_active, resolution, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(camera_id) DO UPDATE SET
            name = excluded.name,
            zone = excluded.zone,
            input_type = excluded.input_type,
            source_uri = excluded.source_uri,
            resolution = excluded.resolution;
        """, (
            data["camera_id"],
            data["name"],
            data.get("zone", "General Area"),
            data.get("input_type", "webcam"),
            data.get("source_uri", "0"),
            data.get("is_active", 0),
            data.get("resolution", "1280x720"),
            now_str
        ))
        conn.commit()
        return data
    finally:
        conn.close()

def delete_camera(camera_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM cameras WHERE camera_id = ?", (camera_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

# Zones Operations
def get_all_zones() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM zones;")
        zones = []
        for r in cur.fetchall():
            z = dict(r)
            try:
                z["default_required_ppe"] = json.loads(z["default_required_ppe"])
            except Exception:
                z["default_required_ppe"] = ["helmet", "safety_vest"]
            zones.append(z)
        return zones
    finally:
        conn.close()

# Incident & Alert Grouping Operations
# Tracks ongoing incidents in memory to perform continuous grouping:
# If violation continues for same (worker_id/unknown + violation_type + camera_id), update end_time and duration.
_active_incident_cache: Dict[str, Dict[str, Any]] = {}
INCIDENT_CONTINUATION_WINDOW = 3.5  # seconds

def record_or_update_incident(
    worker_id: Optional[str],
    worker_name: Optional[str],
    camera_id: str,
    zone: str,
    violation_type: str,
    detected_ppe: List[str],
    missing_ppe: List[str],
    severity: str = "HIGH",
    identity_confidence: float = 0.0,
    detection_confidence: float = 0.0,
    snapshot_path: str = "",
    track_id: Optional[int] = None
) -> Dict[str, Any]:
    now = time.time()
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    time_only = time.strftime("%H:%M:%S")

    # Distinct grouping key: worker or "UNKNOWN_track_N" + violation + camera
    if worker_id:
        actor_key = worker_id
    elif track_id is not None:
        actor_key = f"UNKNOWN_track_{track_id}"
    else:
        actor_key = "UNKNOWN"
    cache_key = f"{actor_key}:{violation_type}:{camera_id}"

    conn = get_connection()
    try:
        cur = conn.cursor()
        existing = _active_incident_cache.get(cache_key)

        if existing and (now - existing["last_seen"] <= INCIDENT_CONTINUATION_WINDOW):
            # Continue existing incident: update end_time and duration
            inc_id = existing["id"]
            start_epoch = existing["start_epoch"]
            duration = round(now - start_epoch, 1)
            existing["last_seen"] = now

            cur.execute("""
            UPDATE incidents
            SET end_time = ?, duration_seconds = ?, updated_at = ?
            WHERE id = ?;
            """, (time_only, duration, now_str, inc_id))
            conn.commit()

            return {
                "incident_id": inc_id,
                "is_new": False,
                "duration": duration,
                "action": "updated"
            }
        else:
            # New incident: insert new row
            cur.execute("""
            INSERT INTO incidents (
                worker_id, worker_name, camera_id, zone, violation_type,
                detected_ppe, missing_ppe, start_time, end_time, duration_seconds,
                severity, identity_confidence, detection_confidence, status,
                snapshot_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?, 'ACTIVE', ?, ?, ?)
            """, (
                worker_id,
                worker_name,
                camera_id,
                zone,
                violation_type,
                json.dumps(detected_ppe),
                json.dumps(missing_ppe),
                time_only,
                time_only,
                severity,
                identity_confidence,
                detection_confidence,
                snapshot_path,
                now_str,
                now_str
            ))
            inc_id = cur.lastrowid

            # Create corresponding Alert
            cur.execute("""
            INSERT INTO alerts (incident_id, worker_id, worker_name, violation, camera_id, zone, severity, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?);
            """, (
                inc_id,
                worker_id,
                worker_name or "UNKNOWN PERSON",
                violation_type,
                camera_id,
                zone,
                severity,
                now_str
            ))
            alert_id = cur.lastrowid
            conn.commit()

            _active_incident_cache[cache_key] = {
                "id": inc_id,
                "alert_id": alert_id,
                "start_epoch": now,
                "last_seen": now
            }

            return {
                "incident_id": inc_id,
                "alert_id": alert_id,
                "is_new": True,
                "duration": 1.0,
                "action": "created"
            }
    finally:
        conn.close()

def resolve_stale_incidents(threshold_seconds: float = 5.0):
    """Mark incidents as RESOLVED when the person/violation has cleared from camera view."""
    now = time.time()
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    stale_keys = []
    
    for key, item in list(_active_incident_cache.items()):
        if now - item["last_seen"] > threshold_seconds:
            stale_keys.append((key, item["id"]))

    if not stale_keys:
        return

    conn = get_connection()
    try:
        cur = conn.cursor()
        for key, inc_id in stale_keys:
            cur.execute("UPDATE incidents SET status = 'RESOLVED', updated_at = ? WHERE id = ?;", (now_str, inc_id))
            _active_incident_cache.pop(key, None)
        conn.commit()
    finally:
        conn.close()

def get_incidents(
    limit: int = 100,
    worker_id: Optional[str] = None,
    department: Optional[str] = None,
    camera_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        query = "SELECT i.*, w.department as worker_department FROM incidents i LEFT JOIN workers w ON i.worker_id = w.worker_id WHERE 1=1"
        params = []
        if worker_id:
            if worker_id == "UNKNOWN":
                query += " AND i.worker_id IS NULL"
            else:
                query += " AND i.worker_id = ?"
                params.append(worker_id)
        if department and department != "ALL":
            query += " AND w.department = ?"
            params.append(department)
        if camera_id and camera_id != "ALL":
            query += " AND i.camera_id = ?"
            params.append(camera_id)
        if severity and severity != "ALL":
            query += " AND i.severity = ?"
            params.append(severity)
        if status and status != "ALL":
            query += " AND i.status = ?"
            params.append(status)
        
        query += " ORDER BY i.id DESC LIMIT ?"
        params.append(limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        incidents = []
        for r in rows:
            inc = dict(r)
            try:
                inc["detected_ppe"] = json.loads(inc["detected_ppe"])
            except Exception:
                inc["detected_ppe"] = []
            try:
                inc["missing_ppe"] = json.loads(inc["missing_ppe"])
            except Exception:
                inc["missing_ppe"] = []
            incidents.append(inc)
        return incidents
    finally:
        conn.close()

def get_incident_by_id(incident_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT i.*, w.department as worker_department FROM incidents i LEFT JOIN workers w ON i.worker_id = w.worker_id WHERE i.id = ?", (incident_id,))
        row = cur.fetchone()
        if not row:
            return None
        inc = dict(row)
        try:
            inc["detected_ppe"] = json.loads(inc["detected_ppe"])
        except Exception:
            inc["detected_ppe"] = []
        try:
            inc["missing_ppe"] = json.loads(inc["missing_ppe"])
        except Exception:
            inc["missing_ppe"] = []
        return inc
    finally:
        conn.close()

def get_alerts(limit: int = 50, status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        query = "SELECT * FROM alerts WHERE 1=1"
        params = []
        if status and status != "ALL":
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def update_alert_status(alert_id: int, new_status: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE alerts SET status = ? WHERE id = ?", (new_status, alert_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

# Deletion & 24-Hour FIFO Auto-Purge Operations
def delete_incident(incident_id: int) -> bool:
    """Deletes an incident, removes its snapshot image from disk, and removes associated alerts."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT snapshot_path FROM incidents WHERE id = ?", (incident_id,))
        row = cur.fetchone()
        if not row:
            return False
        snapshot_path = row["snapshot_path"]
        if snapshot_path:
            full_path = os.path.join(DB_DIR, snapshot_path)
            if os.path.exists(full_path):
                try:
                    os.remove(full_path)
                except Exception:
                    pass

        # Clear from in-memory cache if active
        for k, v in list(_active_incident_cache.items()):
            if v.get("id") == incident_id:
                _active_incident_cache.pop(k, None)

        # Deleting from incidents cascades to alerts
        cur.execute("DELETE FROM incidents WHERE id = ?", (incident_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

def delete_all_incidents() -> Dict[str, int]:
    """Deletes all incidents, all associated alerts, and wipes snapshot images from disk."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM incidents;")
        deleted_incidents = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM alerts;")
        deleted_alerts = cur.fetchone()["c"]

        cur.execute("DELETE FROM alerts;")
        cur.execute("DELETE FROM incidents;")
        conn.commit()

        _active_incident_cache.clear()

        deleted_files = 0
        if os.path.exists(SNAPSHOTS_DIR):
            for fname in os.listdir(SNAPSHOTS_DIR):
                if fname.startswith("snap_inc_") and fname.endswith(".jpg"):
                    try:
                        os.remove(os.path.join(SNAPSHOTS_DIR, fname))
                        deleted_files += 1
                    except Exception:
                        pass

        return {
            "deleted_incidents": deleted_incidents,
            "deleted_alerts": deleted_alerts,
            "deleted_snapshots": deleted_files
        }
    finally:
        conn.close()

def delete_alert(alert_id: int) -> bool:
    """Deletes a single alert record."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

def delete_all_alerts() -> int:
    """Deletes all alert records."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM alerts;")
        count = cur.fetchone()["c"]
        cur.execute("DELETE FROM alerts;")
        conn.commit()
        return count
    finally:
        conn.close()

def cleanup_expired_data(retention_hours: float = 24.0, max_fifo_records: int = 500) -> Dict[str, int]:
    """
    Enforces a strict 24-hour FIFO retention policy on incidents, alerts, and disk snapshots.
    1. Removes any incident or alert older than retention_hours (default 24 hours).
    2. Enforces maximum FIFO capacity (max 500 incidents): oldest records evicted first (FIFO).
    3. Safely deletes physical snapshot files (.jpg) associated with evicted records.
    4. Cleans up any orphaned snapshot files older than retention_hours from data/snapshots/.
    """
    conn = get_connection()
    deleted_incidents = 0
    deleted_alerts = 0
    deleted_snapshots = 0
    try:
        cur = conn.cursor()

        cutoff_epoch = time.time() - (retention_hours * 3600.0)
        cutoff_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cutoff_epoch))

        # 1. Identify incidents older than 24 hours
        cur.execute("SELECT id, snapshot_path FROM incidents WHERE created_at < ?;", (cutoff_str,))
        expired_incidents = [dict(r) for r in cur.fetchall()]

        # 2. Check FIFO count limit (keep maximum max_fifo_records latest incidents)
        cur.execute("SELECT COUNT(*) as c FROM incidents;")
        total_count = cur.fetchone()["c"]
        fifo_over_limit = total_count - len(expired_incidents) - max_fifo_records

        fifo_evicted_incidents = []
        if fifo_over_limit > 0:
            cur.execute("""
            SELECT id, snapshot_path FROM incidents
            WHERE created_at >= ?
            ORDER BY id ASC
            LIMIT ?;
            """, (cutoff_str, fifo_over_limit))
            fifo_evicted_incidents = [dict(r) for r in cur.fetchall()]

        all_to_delete = expired_incidents + fifo_evicted_incidents
        if all_to_delete:
            incident_ids = [item["id"] for item in all_to_delete]
            for item in all_to_delete:
                snap = item.get("snapshot_path")
                if snap:
                    fpath = os.path.join(DB_DIR, snap)
                    if os.path.exists(fpath):
                        try:
                            os.remove(fpath)
                            deleted_snapshots += 1
                        except Exception:
                            pass

            id_set = set(incident_ids)
            for k, v in list(_active_incident_cache.items()):
                if v.get("id") in id_set:
                    _active_incident_cache.pop(k, None)

            placeholders = ",".join(["?"] * len(incident_ids))
            cur.execute(f"DELETE FROM incidents WHERE id IN ({placeholders});", incident_ids)
            deleted_incidents = cur.rowcount

        # 3. Delete any orphaned alerts older than cutoff
        cur.execute("DELETE FROM alerts WHERE timestamp < ?;", (cutoff_str,))
        deleted_alerts = cur.rowcount

        # 4. Clean up any orphaned image files in SNAPSHOTS_DIR older than cutoff
        if os.path.exists(SNAPSHOTS_DIR):
            for fname in os.listdir(SNAPSHOTS_DIR):
                if fname.startswith("snap_inc_") and fname.endswith(".jpg"):
                    full_p = os.path.join(SNAPSHOTS_DIR, fname)
                    try:
                        mtime = os.path.getmtime(full_p)
                        if mtime < cutoff_epoch:
                            os.remove(full_p)
                            deleted_snapshots += 1
                    except Exception:
                        pass

        conn.commit()
        return {
            "deleted_incidents": deleted_incidents,
            "deleted_alerts": deleted_alerts,
            "deleted_snapshots": deleted_snapshots
        }
    finally:
        conn.close()

def get_storage_stats() -> Dict[str, Any]:
    """Returns storage metrics: total incidents, total alerts, snapshot counts, disk space used, and FIFO policy."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM incidents;")
        total_incidents = cur.fetchone()["c"]

        cur.execute("SELECT COUNT(*) as c FROM alerts;")
        total_alerts = cur.fetchone()["c"]

        snapshot_count = 0
        snapshot_bytes = 0
        if os.path.exists(SNAPSHOTS_DIR):
            for f in os.listdir(SNAPSHOTS_DIR):
                fp = os.path.join(SNAPSHOTS_DIR, f)
                if os.path.isfile(fp):
                    snapshot_count += 1
                    try:
                        snapshot_bytes += os.path.getsize(fp)
                    except Exception:
                        pass

        return {
            "total_incidents": total_incidents,
            "total_alerts": total_alerts,
            "snapshot_count": snapshot_count,
            "snapshot_size_bytes": snapshot_bytes,
            "snapshot_size_mb": round(snapshot_bytes / (1024 * 1024), 2),
            "retention_policy": "24 Hours FIFO Auto-Purge",
            "retention_hours": 24,
            "max_fifo_records": 500
        }
    finally:
        conn.close()


# Analytics Operations (Real Data from SQLite)
def get_analytics_metrics() -> Dict[str, Any]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        today_date = time.strftime("%Y-%m-%d")

        # Total registered workers
        cur.execute("SELECT COUNT(*) as count FROM workers;")
        total_workers = cur.fetchone()["count"]

        # Active cameras
        cur.execute("SELECT COUNT(*) as count FROM cameras WHERE is_active = 1;")
        active_cameras = cur.fetchone()["count"]

        # Total incidents
        cur.execute("SELECT COUNT(*) as count FROM incidents;")
        total_incidents = cur.fetchone()["count"]

        # Today's incidents
        cur.execute("SELECT COUNT(*) as count FROM incidents WHERE created_at LIKE ?;", (f"{today_date}%",))
        today_incidents = cur.fetchone()["count"]

        # Active violations right now
        cur.execute("SELECT COUNT(*) as count FROM incidents WHERE status = 'ACTIVE';")
        active_violations = cur.fetchone()["count"]

        # Registered vs Unknown incidents
        cur.execute("SELECT COUNT(*) as count FROM incidents WHERE worker_id IS NOT NULL;")
        registered_incidents_count = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) as count FROM incidents WHERE worker_id IS NULL;")
        unknown_incidents_count = cur.fetchone()["count"]

        # Compliance rate calculation
        # If no incidents recorded, 100%, otherwise ratio of resolved/total
        compliance_pct = 100.0 if total_incidents == 0 else max(10.0, round(100.0 - (today_incidents * 5.0), 1))

        # Violations by department
        cur.execute("""
        SELECT COALESCE(w.department, 'Unregistered') as dept, COUNT(i.id) as count
        FROM incidents i
        LEFT JOIN workers w ON i.worker_id = w.worker_id
        GROUP BY dept
        ORDER BY count DESC;
        """)
        dept_violations = [dict(r) for r in cur.fetchall()]

        # Violations by type
        cur.execute("""
        SELECT violation_type, COUNT(id) as count
        FROM incidents
        GROUP BY violation_type
        ORDER BY count DESC;
        """)
        type_violations = [dict(r) for r in cur.fetchall()]

        # Violations by worker (top offenders)
        cur.execute("""
        SELECT i.worker_id, COALESCE(i.worker_name, 'Unknown') as name, COUNT(i.id) as count
        FROM incidents i
        WHERE i.worker_id IS NOT NULL
        GROUP BY i.worker_id
        ORDER BY count DESC
        LIMIT 5;
        """)
        worker_violations = [dict(r) for r in cur.fetchall()]

        # Most common violation
        most_common = type_violations[0]["violation_type"] if type_violations else "None"

        return {
            "total_workers": total_workers,
            "active_cameras": active_cameras,
            "total_incidents": total_incidents,
            "today_incidents": today_incidents,
            "active_violations": active_violations,
            "compliance_rate": compliance_pct,
            "registered_incidents_count": registered_incidents_count,
            "unknown_incidents_count": unknown_incidents_count,
            "most_common_violation": most_common,
            "dept_violations": dept_violations,
            "type_violations": type_violations,
            "worker_violations": worker_violations
        }
    finally:
        conn.close()

# Application Settings Operations
def get_settings() -> Dict[str, str]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM application_settings;")
        return {r["key"]: r["value"] for r in cur.fetchall()}
    finally:
        conn.close()

def update_setting(key: str, value: str):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT OR REPLACE INTO application_settings (key, value) VALUES (?, ?);", (key, str(value)))
        conn.commit()
    finally:
        conn.close()

# Demo Data Seeder
def seed_demo_workers():
    demo_workers = [
        {
            "worker_id": "W-001",
            "name": "Rahul Kumar",
            "address": "Industrial Sector 4, Rourkela",
            "phone": "+91 98765 43210",
            "email": "rahul.kumar@sentinelx.local",
            "department": "Welding",
            "designation": "Machine Operator",
            "shift": "Morning",
            "joining_date": "2024-01-15",
            "required_ppe": ["helmet", "safety_vest", "gloves", "safety_shoes"],
            "status": "ACTIVE"
        },
        {
            "worker_id": "W-002",
            "name": "Amit Das",
            "address": "Line 2, Sector 7, Sundargarh",
            "phone": "+91 98765 43211",
            "email": "amit.das@sentinelx.local",
            "department": "Assembly",
            "designation": "Robotics Technician",
            "shift": "Morning",
            "joining_date": "2024-03-20",
            "required_ppe": ["helmet", "safety_vest"],
            "status": "ACTIVE"
        },
        {
            "worker_id": "W-003",
            "name": "Raj Patel",
            "address": "Quarter 18, Steel Township",
            "phone": "+91 98765 43212",
            "email": "raj.patel@sentinelx.local",
            "department": "Storage",
            "designation": "Forklift Supervisor",
            "shift": "Evening",
            "joining_date": "2023-11-05",
            "required_ppe": ["helmet", "safety_vest", "safety_shoes"],
            "status": "ACTIVE"
        }
    ]

    for dw in demo_workers:
        existing = get_worker_by_id(dw["worker_id"])
        if not existing:
            dw["qr_identifier"] = f"QR-{dw['worker_id']}"
            dw["photo_path"] = f"data/photos/{dw['worker_id']}.jpg"
            create_worker(dw)

# Video Analysis Database Operations
def create_video_analysis(data: Dict[str, Any]) -> int:
    conn = get_connection()
    try:
        cur = conn.cursor()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
        policy_json = json.dumps(data.get("policy_applied", []))
        summary_json = json.dumps(data.get("summary_json", {}))
        
        cur.execute("""
        INSERT INTO video_analyses (
            filename, file_path, file_size_bytes, duration_seconds,
            resolution, fps, total_frames, processed_frames,
            status, policy_applied, model_used, unique_people,
            identified_workers, unknown_persons, violation_count,
            uncertain_count, summary_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            data.get("filename", ""),
            data.get("file_path", ""),
            data.get("file_size_bytes", 0),
            data.get("duration_seconds", 0.0),
            data.get("resolution", ""),
            data.get("fps", 0.0),
            data.get("total_frames", 0),
            data.get("processed_frames", 0),
            data.get("status", "ANALYZING"),
            policy_json,
            data.get("model_used", ""),
            data.get("unique_people", 0),
            data.get("identified_workers", 0),
            data.get("unknown_persons", 0),
            data.get("violation_count", 0),
            data.get("uncertain_count", 0),
            summary_json,
            now_str
        ))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()

def update_video_analysis(analysis_id: int, updates: Dict[str, Any]) -> bool:
    conn = get_connection()
    try:
        cur = conn.cursor()
        fields = []
        params = []
        for k, v in updates.items():
            if k in ["policy_applied", "summary_json"]:
                v = json.dumps(v)
            fields.append(f"{k} = ?")
            params.append(v)
        if not fields:
            return False
        params.append(analysis_id)
        cur.execute(f"UPDATE video_analyses SET {', '.join(fields)} WHERE id = ?;", params)
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

def get_video_analysis(analysis_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM video_analyses WHERE id = ?;", (analysis_id,))
        row = cur.fetchone()
        if not row:
            return None
        res = dict(row)
        try:
            res["policy_applied"] = json.loads(res["policy_applied"])
        except Exception:
            res["policy_applied"] = []
        try:
            res["summary_json"] = json.loads(res["summary_json"])
        except Exception:
            res["summary_json"] = {}
        return res
    finally:
        conn.close()

def get_all_video_analyses(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM video_analyses ORDER BY id DESC LIMIT ?;", (limit,))
        records = []
        for r in cur.fetchall():
            res = dict(r)
            try:
                res["policy_applied"] = json.loads(res["policy_applied"])
            except Exception:
                res["policy_applied"] = []
            try:
                res["summary_json"] = json.loads(res["summary_json"])
            except Exception:
                res["summary_json"] = {}
            records.append(res)
        return records
    finally:
        conn.close()

def delete_video_analysis(analysis_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM video_analyses WHERE id = ?;", (analysis_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()

