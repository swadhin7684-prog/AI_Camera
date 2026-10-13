import os
import sys
import shutil
import hashlib
import sqlite3
from datetime import datetime, timezone
import subprocess
import json

def sha256_file(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def check_db_integrity(db_path: str) -> dict:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check;")
        res = cursor.fetchall()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()
        return {
            "readable": True,
            "integrity_check": [r[0] for r in res],
            "table_count": len(tables),
            "tables": tables
        }
    except Exception as e:
        return {"readable": False, "error": str(e)}

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%SZ")
    backup_dir = os.path.join(repo_root, "backups", f"v1.1.0_pre_v2_baseline_{timestamp}")
    
    db_backup_dir = os.path.join(backup_dir, "databases")
    appdata_db_backup_dir = os.path.join(backup_dir, "appdata_databases")
    release_backup_dir = os.path.join(backup_dir, "release_artifacts_v1.1.0")
    source_backup_dir = os.path.join(backup_dir, "source_snapshot")
    
    os.makedirs(db_backup_dir, exist_ok=True)
    os.makedirs(appdata_db_backup_dir, exist_ok=True)
    os.makedirs(release_backup_dir, exist_ok=True)
    os.makedirs(source_backup_dir, exist_ok=True)
    
    manifest = {
        "timestamp_utc": timestamp,
        "backup_directory": backup_dir,
        "git_commit": None,
        "files": [],
        "database_verifications": {}
    }
    checksums_lines = []

    # 1. Source Snapshot (git bundle + git rev-parse)
    try:
        git_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root, text=True).strip()
        manifest["git_commit"] = git_commit
        bundle_path = os.path.join(source_backup_dir, "sentinelx_v1.1.0_git_repo.bundle")
        subprocess.check_call(["git", "bundle", "create", bundle_path, "HEAD"], cwd=repo_root)
        c_hash = sha256_file(bundle_path)
        manifest["files"].append({
            "category": "source_bundle",
            "name": os.path.basename(bundle_path),
            "original_path": "git repository HEAD",
            "backup_path": bundle_path,
            "size_bytes": os.path.getsize(bundle_path),
            "sha256": c_hash
        })
        checksums_lines.append(f"{c_hash}  {os.path.relpath(bundle_path, backup_dir)}")
    except Exception as e:
        manifest["source_snapshot_error"] = str(e)

    # 2. Workspace Databases
    workspace_dbs = ["sentinelx.db", "sentinelx_admin.db"]
    for db_name in workspace_dbs:
        src = os.path.join(repo_root, db_name)
        if os.path.exists(src):
            dst = os.path.join(db_backup_dir, db_name)
            shutil.copy2(src, dst)
            orig_hash = sha256_file(src)
            copy_hash = sha256_file(dst)
            assert orig_hash == copy_hash, f"Hash mismatch on {db_name} backup!"
            
            db_check = check_db_integrity(dst)
            manifest["database_verifications"][f"workspace/{db_name}"] = db_check
            manifest["files"].append({
                "category": "workspace_database",
                "name": db_name,
                "original_path": src,
                "backup_path": dst,
                "size_bytes": os.path.getsize(dst),
                "sha256": copy_hash
            })
            checksums_lines.append(f"{copy_hash}  {os.path.relpath(dst, backup_dir)}")

    # 3. AppData Databases
    appdata = os.environ.get("APPDATA")
    if appdata:
        appdata_dir = os.path.join(appdata, "SentinelX AI")
        if os.path.exists(appdata_dir):
            for db_name in ["sentinelx.db", "sentinelx_admin.db", "declarative_performance_observer.db"]:
                src = os.path.join(appdata_dir, db_name)
                if os.path.exists(src):
                    dst = os.path.join(appdata_db_backup_dir, db_name)
                    shutil.copy2(src, dst)
                    orig_hash = sha256_file(src)
                    copy_hash = sha256_file(dst)
                    assert orig_hash == copy_hash, f"Hash mismatch on AppData {db_name} backup!"
                    
                    db_check = check_db_integrity(dst)
                    manifest["database_verifications"][f"appdata/{db_name}"] = db_check
                    manifest["files"].append({
                        "category": "appdata_database",
                        "name": db_name,
                        "original_path": src,
                        "backup_path": dst,
                        "size_bytes": os.path.getsize(dst),
                        "sha256": copy_hash
                    })
                    checksums_lines.append(f"{copy_hash}  {os.path.relpath(dst, backup_dir)}")

    # 4. Release Artifacts v1.1.0
    release_dir = os.path.join(repo_root, "release")
    if os.path.exists(release_dir):
        for item in os.listdir(release_dir):
            src = os.path.join(release_dir, item)
            if os.path.isfile(src):
                dst = os.path.join(release_backup_dir, item)
                shutil.copy2(src, dst)
                orig_hash = sha256_file(src)
                copy_hash = sha256_file(dst)
                assert orig_hash == copy_hash, f"Hash mismatch on release {item} backup!"
                
                manifest["files"].append({
                    "category": "release_artifact_v1.1.0",
                    "name": item,
                    "original_path": src,
                    "backup_path": dst,
                    "size_bytes": os.path.getsize(dst),
                    "sha256": copy_hash
                })
                checksums_lines.append(f"{copy_hash}  {os.path.relpath(dst, backup_dir)}")

    # Write manifest and checksums.sha256
    manifest_path = os.path.join(backup_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    checksums_path = os.path.join(backup_dir, "checksums.sha256")
    with open(checksums_path, "w", encoding="utf-8") as f:
        f.write("\n".join(checksums_lines) + "\n")

    print("=== BACKUP COMPLETED SUCCESSFULLY ===")
    print(f"Location: {backup_dir}")
    print(f"Total files backed up: {len(manifest['files'])}")
    for f in manifest["files"]:
        print(f" - [{f['category']}] {f['name']} ({f['size_bytes']:,} bytes) SHA-256: {f['sha256'][:16]}...")
    print("Database Verifications:")
    for db_k, db_v in manifest["database_verifications"].items():
        print(f" - {db_k}: readable={db_v.get('readable')}, tables={db_v.get('table_count')}, integrity={db_v.get('integrity_check')}")

if __name__ == "__main__":
    main()
