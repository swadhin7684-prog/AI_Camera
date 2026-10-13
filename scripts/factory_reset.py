"""
SentinelX AI — Full Factory Reset Utility.
Clears all admin accounts, company licenses, workers, incident logs,
and local license files so both Admin and User panels start from fresh first-time setup.
"""

import os
import sys
import sqlite3
import glob

# Add parent directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.paths import (
    APP_DATA_DIR,
    DB_PATH,
    ADMIN_DB_PATH,
    LICENSE_FILE_PATH,
    STATION_LEASE_FILE_PATH,
    ADMIN_SECRET_FILE,
    DATA_DIR,
    PHOTOS_DIR,
    QRCODES_DIR,
    SNAPSHOTS_DIR,
    UPLOADS_DIR
)
from backend.database.db import init_db
from backend.database.admin_db import init_admin_db

def reset_database(db_path: str, is_admin: bool):
    if not os.path.exists(db_path):
        return
    print(f"Resetting database tables in: {db_path}")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # Dynamically discover and wipe all user tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cur.fetchall()]
    for t in tables:
        try:
            cur.execute(f"DELETE FROM {t};")
            print(f"  - Cleared table '{t}'")
        except Exception as e:
            print(f"  - Warning clearing table '{t}': {e}")

    try:
        cur.execute("DELETE FROM sqlite_sequence;")
    except Exception:
        pass

    conn.commit()
    conn.close()

def clear_directory_files(directory_path: str):
    if not os.path.exists(directory_path):
        return
    count = 0
    for root, _, files in os.walk(directory_path):
        for f in files:
            p = os.path.join(root, f)
            try:
                os.remove(p)
                count += 1
            except Exception as e:
                print(f"  Could not remove {p}: {e}")
    print(f"  - Cleared {count} files from: {directory_path}")

def remove_file(filepath: str):
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            print(f"  - Removed file: {filepath}")
        except Exception as e:
            print(f"  Could not remove {filepath}: {e}")

def main():
    print("==========================================================")
    print("   SENTINELX AI — FULL FACTORY RESET IN PROGRESS          ")
    print("==========================================================")
    
    # 1. Reset Workspace Databases
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    ws_db = os.path.join(repo_root, "sentinelx.db")
    ws_admin_db = os.path.join(repo_root, "sentinelx_admin.db")
    reset_database(ws_db, is_admin=False)
    reset_database(ws_admin_db, is_admin=True)

    # 2. Reset AppData Databases
    if APP_DATA_DIR and os.path.exists(APP_DATA_DIR):
        appdata_db = os.path.join(APP_DATA_DIR, "sentinelx.db")
        appdata_admin_db = os.path.join(APP_DATA_DIR, "sentinelx_admin.db")
        if os.path.abspath(appdata_db) != os.path.abspath(ws_db):
            reset_database(appdata_db, is_admin=False)
            reset_database(appdata_admin_db, is_admin=True)

    # 3. Remove license tokens & signing secret
    print("\nRemoving license files and signing secrets:")
    remove_file(LICENSE_FILE_PATH)
    remove_file(STATION_LEASE_FILE_PATH)
    remove_file(ADMIN_SECRET_FILE)
    remove_file(os.path.join(repo_root, "sentinelx_license.json"))
    remove_file(os.path.join(repo_root, "sentinelx_lease.json"))
    remove_file(os.path.join(repo_root, ".admin_signing_key"))

    # 4. Clean snapshots, photos, and uploaded evidence
    print("\nPurging incident snapshots and worker photos:")
    clear_directory_files(PHOTOS_DIR)
    clear_directory_files(QRCODES_DIR)
    clear_directory_files(SNAPSHOTS_DIR)
    clear_directory_files(UPLOADS_DIR)
    
    ws_data = os.path.join(repo_root, "data")
    if os.path.abspath(ws_data) != os.path.abspath(DATA_DIR):
        clear_directory_files(os.path.join(ws_data, "photos"))
        clear_directory_files(os.path.join(ws_data, "qrcodes"))
        clear_directory_files(os.path.join(ws_data, "snapshots"))
        clear_directory_files(os.path.join(ws_data, "uploads"))

    # 5. Re-initialize baseline schema defaults
    print("\nRe-initializing fresh baseline schemas & settings:")
    init_db()
    init_admin_db()

    print("\n==========================================================")
    print("   FACTORY RESET COMPLETED SUCCESSFULLY!                  ")
    print("   - Admin Panel: Ready for First-Time Super Admin Setup  ")
    print("   - User Panel: Clean state (0 workers, 0 incidents)     ")
    print("==========================================================")

if __name__ == "__main__":
    main()
