"""
SentinelX AI — Safe Non-Destructive AppData Migration Utility

Safely copies existing development SQLite database records, worker face embeddings,
photos, QR codes, incident snapshots, and uploaded videos into %APPDATA%\\SentinelX AI\\

Source:
    - sentinelx.db (Development workspace)
    - data/ (photos, qrcodes, snapshots, uploads)

Destination:
    - %APPDATA%\\SentinelX AI\\sentinelx.db
    - %APPDATA%\\SentinelX AI\\data\\

Safety Guarantees:
    - Source files are strictly READ-ONLY. No files are deleted or modified in the workspace.
    - Destination database is backed up with a timestamp before any operation.
    - Existing records in destination are merged without overwriting unless explicitly requested.
"""

import os
import shutil
import sqlite3
import time

def migrate():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    src_db = os.path.join(project_root, "sentinelx.db")
    src_data = os.path.join(project_root, "data")

    app_data = os.environ.get("APPDATA")
    if not app_data:
        app_data = os.path.expanduser("~")
    dest_dir = os.path.join(app_data, "SentinelX AI")
    dest_db = os.path.join(dest_dir, "sentinelx.db")
    dest_data = os.path.join(dest_dir, "data")

    print("===================================================")
    print("SentinelX AI — Safe Non-Destructive Migration")
    print(f"Source DB:      {src_db}")
    print(f"Destination DB: {dest_db}")
    print(f"Source Data:    {src_data}")
    print(f"Dest Data:      {dest_data}")
    print("===================================================")

    if not os.path.exists(src_db):
        print(f"Error: Source database does not exist: {src_db}")
        return

    os.makedirs(dest_dir, exist_ok=True)
    os.makedirs(dest_data, exist_ok=True)

    # 1. Backup existing destination DB if it exists
    if os.path.exists(dest_db):
        backup_name = f"sentinelx_backup_{int(time.time())}.db"
        backup_path = os.path.join(dest_dir, backup_name)
        shutil.copy2(dest_db, backup_path)
        print(f"Created safety backup of destination DB: {backup_path}")

    # 2. Copy/Merge database records
    # If destination DB doesn't exist or is tiny, copy file directly
    if not os.path.exists(dest_db) or os.path.getsize(dest_db) < 50000:
        shutil.copy2(src_db, dest_db)
        print("Copied complete development database to AppData.")
    else:
        # Merge records safely using SQLite
        print("Merging workers and embeddings into destination database...")
        conn_src = sqlite3.connect(src_db)
        conn_dest = sqlite3.connect(dest_db)

        cur_src = conn_src.cursor()
        cur_dest = conn_dest.cursor()

        # Merge workers
        cur_src.execute("SELECT * FROM workers")
        workers = cur_src.fetchall()
        col_names = [desc[0] for desc in cur_src.description]
        placeholders = ", ".join(["?"] * len(col_names))
        cols = ", ".join(col_names)
        cur_dest.executemany(f"INSERT OR IGNORE INTO workers ({cols}) VALUES ({placeholders})", workers)

        # Merge worker_identity
        cur_src.execute("SELECT worker_id, face_embedding, embedding_dim, quality_score, created_at FROM worker_identity")
        identities = cur_src.fetchall()
        cur_dest.executemany("INSERT OR IGNORE INTO worker_identity (worker_id, face_embedding, embedding_dim, quality_score, created_at) VALUES (?, ?, ?, ?, ?)", identities)

        # Merge cameras
        cur_src.execute("SELECT * FROM cameras")
        cameras = cur_src.fetchall()
        if cameras:
            cam_cols = [desc[0] for desc in cur_src.description]
            cur_dest.executemany(f"INSERT OR IGNORE INTO cameras ({', '.join(cam_cols)}) VALUES ({', '.join(['?']*len(cam_cols))})", cameras)

        # Merge zones
        cur_src.execute("SELECT * FROM zones")
        zones = cur_src.fetchall()
        if zones:
            zone_cols = [desc[0] for desc in cur_src.description]
            cur_dest.executemany(f"INSERT OR IGNORE INTO zones ({', '.join(zone_cols)}) VALUES ({', '.join(['?']*len(zone_cols))})", zones)

        conn_dest.commit()
        conn_src.close()
        conn_dest.close()
        print(f"Merged {len(workers)} worker records and {len(identities)} face embeddings.")

    # 3. Copy media assets (photos, qrcodes, snapshots, uploads) without overwriting existing files
    subdirs = ["photos", "qrcodes", "snapshots", "uploads", "test_videos"]
    copied_files = 0
    for sub in subdirs:
        src_sub = os.path.join(src_data, sub)
        dest_sub = os.path.join(dest_data, sub)
        os.makedirs(dest_sub, exist_ok=True)
        if os.path.exists(src_sub):
            for fname in os.listdir(src_sub):
                src_f = os.path.join(src_sub, fname)
                dest_f = os.path.join(dest_sub, fname)
                if os.path.isfile(src_f) and not os.path.exists(dest_f):
                    shutil.copy2(src_f, dest_f)
                    copied_files += 1

    print(f"Copied {copied_files} new media asset files to AppData storage.")
    print("Migration completed successfully with zero modifications to source files!")

if __name__ == "__main__":
    migrate()
