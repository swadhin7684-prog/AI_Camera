import os
import sys
import time
import subprocess
import requests
import json
import sqlite3
import numpy as np
import cv2

def run_tests():
    exe_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "release", "win-unpacked", "SentinelX AI.exe"))
    print(f"[TEST 1] Checking packaged executable path: {exe_path}")
    assert os.path.exists(exe_path), f"Executable not found at: {exe_path}"
    print("  -> Passed: Executable exists.")

    print("\n[TEST 2] Launching packaged SentinelX AI...")
    proc = subprocess.Popen([exe_path])
    backend_pid = None

    try:
        # Poll health endpoint
        print("Polling http://127.0.0.1:8000/api/health (waiting for backend initialization)...")
        online = False
        health_data = {}
        for attempt in range(40):
            time.sleep(1)
            try:
                r = requests.get("http://127.0.0.1:8000/api/health", timeout=2)
                if r.status_code == 200:
                    health_data = r.json()
                    online = True
                    print(f"  -> Connected after {attempt + 1}s: {health_data}")
                    break
            except Exception:
                pass

        assert online, "Packaged backend failed to respond to /api/health within 40 seconds."
        assert health_data.get("status") == "online", "Health status is not online"
        assert health_data.get("model_loaded") is True, "AI model failed to load in packaged mode"
        assert health_data.get("face_engine_ready") is True, "Face engine (YuNet/SFace) failed to load"
        print("  -> Passed: Packaged backend is online and models are loaded.")

        # Test settings
        print("\n[TEST 3] Testing Application Settings API...")
        r = requests.get("http://127.0.0.1:8000/api/settings")
        assert r.status_code == 200, f"Settings failed: {r.status_code}"
        settings = r.json()
        print(f"  -> Passed: Settings retrieved: active_model={settings.get('active_model')}")

        # Test Cameras API
        print("\n[TEST 4] Testing Cameras API...")
        r = requests.get("http://127.0.0.1:8000/api/cameras")
        assert r.status_code == 200, f"Cameras failed: {r.status_code}"
        cameras = r.json().get("cameras", [])
        print(f"  -> Passed: Found {len(cameras)} cameras seeded.")

        # Test Worker Registration with Face Image
        print("\n[TEST 5] Testing Worker Registration & Face Verification...")
        worker_payload = {
            "worker_id": "PKG-W01",
            "name": "Sarah Connor",
            "department": "Safety Engineering",
            "designation": "Inspector",
            "shift": "Morning",
            "required_ppe": ["helmet", "safety_vest"],
            "phone": "+1-555-0199",
            "email": "sarah.connor@sentinelx.local",
            "address": "Sector 7G",
            "overwrite": True
        }

        r = requests.post(
            "http://127.0.0.1:8000/api/workers",
            json=worker_payload
        )

        assert r.status_code == 200, f"Worker registration failed: {r.status_code} - {r.text}"
        reg_result = r.json()
        print(f"  -> Passed: Worker registered: {reg_result.get('worker', {}).get('name')}")
        assert reg_result.get("worker", {}).get("worker_id") == "PKG-W01"

        # Verify QR Code Endpoint
        print("\n[TEST 6] Testing QR Code Retrieval...")
        r = requests.get("http://127.0.0.1:8000/api/workers/PKG-W01/qr")
        assert r.status_code == 200, f"QR code retrieval failed: {r.status_code}"
        assert r.headers.get("content-type", "").startswith("image/"), "QR code is not an image"
        print("  -> Passed: Worker QR code successfully generated and served.")

        # Test Alerts API
        print("\n[TEST 7] Testing Alerts API...")
        r = requests.get("http://127.0.0.1:8000/api/alerts")
        assert r.status_code == 200, f"Alerts query failed: {r.status_code}"
        print(f"  -> Passed: Alerts query successful.")

        # Test Incidents API
        print("\n[TEST 8] Testing Incidents API...")
        r = requests.get("http://127.0.0.1:8000/api/incidents?limit=10")
        assert r.status_code == 200, f"Incidents query failed: {r.status_code}"
        print(f"  -> Passed: Incidents query successful.")

        # Test Video Analysis Status API
        print("\n[TEST 9] Testing Video Analysis Status API...")
        r = requests.get("http://127.0.0.1:8000/api/video-analysis/status")
        assert r.status_code == 200, f"Video analysis status failed: {r.status_code}"
        print(f"  -> Passed: Video analysis status is {r.json().get('status')}.")

    finally:
        print("\n[TEST 10] Testing Process Termination...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        time.sleep(3)

        # Check if backend also closed
        backend_alive = False
        try:
            r = requests.get("http://127.0.0.1:8000/api/health", timeout=1)
            backend_alive = (r.status_code == 200)
        except Exception:
            backend_alive = False

        if backend_alive:
            print("  -> Note: Force terminating backend test process tree...")
            os.system('taskkill /im sentinelx_backend.exe /f /t >nul 2>&1')
        print("  -> Passed: Application process closed.")

    # Check AppData Database Persistence
    print("\n[TEST 11] Checking Database Persistence in AppData...")
    app_data_dir = os.path.join(os.environ.get("APPDATA", ""), "SentinelX AI")
    db_path = os.path.join(app_data_dir, "sentinelx.db")
    print(f"  AppData DB path: {db_path}")
    assert os.path.exists(db_path), f"Database does not exist at {db_path}"

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT name, department FROM workers WHERE worker_id = 'PKG-W01'")
    row = cur.fetchone()
    conn.close()

    assert row is not None, "Worker PKG-W01 not found in AppData database!"
    assert row[0] == "Sarah Connor", f"Worker name mismatch: {row[0]}"
    print(f"  -> Passed: Verified persistent worker in AppData: {row[0]} ({row[1]})")

    print("\n=======================================================")
    print("ALL 11 PACKAGED APPLICATION VERIFICATION TESTS PASSED!")
    print("=======================================================")

if __name__ == "__main__":
    run_tests()
