import sys
import os
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from backend.main import app
from backend.database.db import (
    init_db, get_all_workers, get_worker_by_id,
    record_or_update_incident, get_incidents,
    get_analytics_metrics, seed_demo_workers
)

def run_tests():
    print("="*60)
    print("RUNNING SENTINELX AI VERIFICATION SUITE")
    print("="*60)

    # 1. Test Database Init
    init_db()
    print("[PASS] 1. SQLite Database initialized.")

    client = TestClient(app)

    # 2. Test Health Endpoint
    res = client.get("/api/health")
    # /api/health or /api/settings
    res = client.get("/api/settings")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    print("[PASS] 2. Settings & AI Model Info API responds 200.")
    print("       Active Model:", res.json().get("model_info", {}).get("loaded_model"))
    print("       Supported Classes:", res.json().get("model_info", {}).get("supported_classes"))

    # 3. Test Worker Registration
    worker_payload = {
        "worker_id": "W-TEST-99",
        "name": "Vikram Singh",
        "department": "Welding",
        "designation": "Arc Welder",
        "shift": "Morning",
        "required_ppe": ["helmet", "safety_vest", "gloves"]
    }
    reg_res = client.post("/api/workers", json=worker_payload)
    assert reg_res.status_code == 200, f"Registration failed: {reg_res.text}"
    worker_data = reg_res.json()["worker"]
    assert worker_data["worker_id"] == "W-TEST-99"
    assert worker_data["qr_identifier"] == "SENTINELX-ID-W-TEST-99"
    print("[PASS] 3. Worker Registration successful. Worker ID & Unique QR generated.")

    # 4. Test Duplicate Worker ID Rejection
    dup_res = client.post("/api/workers", json=worker_payload)
    assert dup_res.status_code == 400, "Expected 400 for duplicate Worker ID"
    print("[PASS] 4. Duplicate Worker ID rejected with 400 error.")

    # 5. Test QR Lookup
    qr_res = client.post("/api/qr/scan", json={"qr_text": "SENTINELX-ID-W-TEST-99"})
    assert qr_res.status_code == 200
    assert qr_res.json()["status"] == "success"
    assert qr_res.json()["worker"]["name"] == "Vikram Singh"
    print("[PASS] 5. QR Scan & Lookup matches registered worker Vikram Singh.")

    # 6. Test Incident Grouping & Continuous Debounce
    # Insert first violation
    inc1 = record_or_update_incident(
        worker_id="W-TEST-99",
        worker_name="Vikram Singh",
        camera_id="CAM-01",
        zone="Welding Area",
        violation_type="High-Visibility Vest Missing",
        detected_ppe=["helmet", "gloves"],
        missing_ppe=["safety_vest"],
        severity="HIGH"
    )
    assert inc1["is_new"] == True
    inc_id = inc1["incident_id"]

    # Continuous frame update within window
    time.sleep(0.5)
    inc2 = record_or_update_incident(
        worker_id="W-TEST-99",
        worker_name="Vikram Singh",
        camera_id="CAM-01",
        zone="Welding Area",
        violation_type="High-Visibility Vest Missing",
        detected_ppe=["helmet", "gloves"],
        missing_ppe=["safety_vest"],
        severity="HIGH"
    )
    assert inc2["is_new"] == False
    assert inc2["incident_id"] == inc_id
    assert inc2["duration"] >= 0.5
    print(f"[PASS] 6. Incident Continuous Grouping verified (Incident #{inc_id} updated, duration {inc2['duration']}s).")

    # 7. Test Unknown Person Incident (worker_id = NULL)
    inc_unk = record_or_update_incident(
        worker_id=None,
        worker_name=None,
        camera_id="CAM-01",
        zone="Welding Area",
        violation_type="Safety Helmet Missing",
        detected_ppe=["safety_vest"],
        missing_ppe=["helmet"],
        severity="HIGH"
    )
    assert inc_unk["is_new"] == True
    all_inc = get_incidents(limit=10)
    unk_rec = next((i for i in all_inc if i["id"] == inc_unk["incident_id"]), None)
    assert unk_rec is not None
    assert unk_rec["worker_id"] is None
    print("[PASS] 7. Unknown Person Violation verified (worker_id = NULL, unlinked from registered staff).")

    # 8. Test Analytics Calculation from Real DB
    analytics = get_analytics_metrics()
    assert analytics["total_workers"] >= 1
    assert analytics["total_incidents"] >= 2
    assert analytics["unknown_incidents_count"] >= 1
    assert analytics["registered_incidents_count"] >= 1
    print(f"[PASS] 8. Real Analytics computed from SQLite: Total Workers={analytics['total_workers']}, Incidents={analytics['total_incidents']}, Compliance={analytics['compliance_rate']}%.")

    # 9. Clean up test worker
    from backend.database.db import delete_worker
    delete_worker("W-TEST-99")
    print("[PASS] 9. Test Worker cleanup completed.")

    print("="*60)
    print("ALL 9 VERIFICATION PHASES PASSED WITH ZERO ERRORS!")
    print("="*60)

if __name__ == "__main__":
    run_tests()
