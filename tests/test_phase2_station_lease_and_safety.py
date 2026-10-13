"""
Phase 2 Automated Test Suite: Asymmetric Station Lease (Ed25519) & Safety-Preserving Degraded Mode.
Validates:
1. Canonical JSON deterministic serialization (RFC 8785).
2. Ed25519 signature creation & verification (valid, tampered payload, tampered signature).
3. Hardware binding & mismatch handling.
4. Expiry, offline grace period, and degraded safety mode evaluation.
5. Clock anomaly detection.
6. Local Emergency Safety Evidence Package (ZIP) export.
7. Dual-mode license resolution & legacy HMAC coexistence with explicit deprecation tagging.
"""

import os
import json
import time
import base64
import zipfile
import io
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric import ed25519

from backend.main import app
from backend.auth.station_lease_verifier import (
    canonical_json_bytes,
    verify_station_lease,
    compute_machine_fingerprint,
    REQUIRED_CANONICAL_FIELDS
)
from backend.services.license_service import (
    get_current_license_status,
    activate_station_lease
)
from backend.paths import (
    STATION_LEASE_FILE_PATH,
    LICENSE_FILE_PATH,
    SNAPSHOTS_DIR
)


@pytest.fixture
def ed25519_keypair():
    """Generates an ephemeral Ed25519 private/public keypair in memory for testing."""
    priv = ed25519.Ed25519PrivateKey.generate()
    pub = priv.public_key()
    pub_bytes = pub.public_bytes_raw()
    key_id = "test-ed25519-v1"
    keyring = {key_id: pub_bytes}
    return priv, pub_bytes, key_id, keyring


def create_signed_lease(
    priv_key,
    key_id: str,
    company_id: str = "COMP-ALPHA-001",
    station_id: str = "STATION-WELD-01",
    machine_fingerprint: str = "test-machine-fingerprint-12345",
    issued_at: str = None,
    lease_expiry: str = None,
    grace_period_until: str = None,
    schema_version: int = 2,
    revocation_epoch: int = 10,
    plan_tier: str = "Enterprise",
    max_cameras: int = 8,
    features: list = None
) -> dict:
    now = datetime.now(timezone.utc)
    if not issued_at:
        issued_at = (now - timedelta(hours=1)).isoformat()
    if not lease_expiry:
        lease_expiry = (now + timedelta(days=30)).isoformat()
    if not grace_period_until:
        grace_period_until = (now + timedelta(days=37)).isoformat()
    if features is None:
        features = ["ppe_inference", "face_recognition", "audio_alarm", "local_logging"]

    payload = {
        "schema_version": schema_version,
        "lease_id": "lease_" + str(int(time.time())),
        "company_id": company_id,
        "company_name": "Alpha Manufacturing",
        "station_id": station_id,
        "machine_fingerprint": machine_fingerprint,
        "plan_tier": plan_tier,
        "max_cameras": max_cameras,
        "features": features,
        "issued_at": issued_at,
        "lease_expiry": lease_expiry,
        "grace_period_until": grace_period_until,
        "grace_days": 7,
        "key_id": key_id,
        "revocation_epoch": revocation_epoch
    }

    canonical_bytes = canonical_json_bytes(payload)
    sig_raw = priv_key.sign(canonical_bytes)
    sig_b64 = base64.b64encode(sig_raw).decode("ascii")

    return {
        "schema_version": schema_version,
        "key_id": key_id,
        "payload": payload,
        "signature": sig_b64
    }


class TestStationLeaseEd25519:

    def test_canonical_json_determinism(self):
        """Tests that different key orders produce byte-identical canonical output."""
        d1 = {"z": 1, "a": 2, "m": [3, 2, 1], "sub": {"k2": "val", "k1": 10}}
        d2 = {"a": 2, "sub": {"k1": 10, "k2": "val"}, "m": [3, 2, 1], "z": 1}
        assert canonical_json_bytes(d1) == canonical_json_bytes(d2)

    def test_valid_station_lease_verification(self, ed25519_keypair):
        """Tests that a valid Ed25519 lease decodes and matches all parameters."""
        priv, pub_bytes, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"

        lease = create_signed_lease(priv, key_id, machine_fingerprint=hw_fp)
        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)

        assert res["is_valid"] is True
        assert res["status"] == "ACTIVE_VALID"
        assert res["mode"] == "ACTIVE"
        assert res["safety_monitoring_active"] is True
        assert res["company_id"] == "COMP-ALPHA-001"
        assert res["station_id"] == "STATION-WELD-01"
        assert res["license_format"] == "V2_ED25519_LEASE"

    def test_tampered_payload_rejected(self, ed25519_keypair):
        """Tests that altering a single field in payload invalidates Ed25519 signature."""
        priv, _, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"

        lease = create_signed_lease(priv, key_id, machine_fingerprint=hw_fp)
        # Maliciously attempt to elevate max_cameras from 8 to 64
        lease["payload"]["max_cameras"] = 64

        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)
        assert res["is_valid"] is False
        assert res["status"] == "TAMPERED"
        assert res["mode"] == "DEGRADED"
        # SAFETY INVARIANT: safety monitoring remains active even if tampered
        assert res["safety_monitoring_active"] is True

    def test_tampered_signature_rejected(self, ed25519_keypair):
        """Tests that an altered signature byte fails verification."""
        priv, _, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"

        lease = create_signed_lease(priv, key_id, machine_fingerprint=hw_fp)
        corrupted_sig = "A" + lease["signature"][1:]
        lease["signature"] = corrupted_sig

        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)
        assert res["is_valid"] is False
        assert res["status"] == "TAMPERED"
        assert res["safety_monitoring_active"] is True

    def test_hardware_mismatch_enters_degraded_mode(self, ed25519_keypair):
        """Tests that a lease copied to another PC triggers HARDWARE_MISMATCH with degraded safety."""
        priv, _, key_id, keyring = ed25519_keypair
        registered_fp = "pc-motherboard-guid-station-01"
        different_pc_fp = "rogue-different-pc-motherboard-guid"

        lease = create_signed_lease(priv, key_id, machine_fingerprint=registered_fp)
        res = verify_station_lease(lease, expected_fingerprint=different_pc_fp, trusted_public_keys=keyring)

        assert res["is_valid"] is False
        assert res["status"] == "HARDWARE_MISMATCH"
        assert res["mode"] == "DEGRADED"
        # Safety monitoring must NOT halt
        assert res["safety_monitoring_active"] is True
        assert "cctv_capture" in res["features_allowed"]
        assert "ppe_inference" in res["features_allowed"]
        assert "worker_enrollment" in res["features_restricted"]

    def test_offline_grace_period_evaluation(self, ed25519_keypair):
        """Tests that an expired lease within the 7-day grace period is marked OFFLINE_GRACE."""
        priv, _, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"
        now = datetime.now(timezone.utc)

        # Expired 2 days ago, but grace period valid for another 5 days
        lease_expiry = (now - timedelta(days=2)).isoformat()
        grace_until = (now + timedelta(days=5)).isoformat()

        lease = create_signed_lease(
            priv, key_id,
            machine_fingerprint=hw_fp,
            lease_expiry=lease_expiry,
            grace_period_until=grace_until
        )
        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)

        assert res["is_valid"] is True
        assert res["status"] == "OFFLINE_GRACE"
        assert res["mode"] == "ACTIVE"
        assert res["days_remaining"] == 4 or res["days_remaining"] == 5
        assert res["safety_monitoring_active"] is True

    def test_grace_expired_enters_safety_preserving_degraded_mode(self, ed25519_keypair):
        """Tests that when grace period expires, station drops to DEGRADED_SAFETY_MODE without halting hazard detection."""
        priv, _, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"
        now = datetime.now(timezone.utc)

        # Expired 10 days ago, grace period ended 3 days ago
        lease_expiry = (now - timedelta(days=10)).isoformat()
        grace_until = (now - timedelta(days=3)).isoformat()

        lease = create_signed_lease(
            priv, key_id,
            machine_fingerprint=hw_fp,
            lease_expiry=lease_expiry,
            grace_period_until=grace_until
        )
        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)

        assert res["is_valid"] is False
        assert res["status"] == "DEGRADED_SAFETY_MODE"
        assert res["mode"] == "DEGRADED"
        assert res["safety_monitoring_active"] is True
        assert "cctv_capture" in res["features_allowed"]
        assert "ppe_inference" in res["features_allowed"]
        assert "audio_alarm" in res["features_allowed"]
        assert "emergency_evidence_export" in res["features_allowed"]

    def test_clock_anomaly_detected_safely(self, ed25519_keypair):
        """Tests that setting clock earlier than lease issuance triggers CLOCK_ANOMALY without halting safety loops."""
        priv, _, key_id, keyring = ed25519_keypair
        hw_fp = "matched-hw-fp-9988"
        now = datetime.now(timezone.utc)

        # Lease issued in future (e.g. system clock was turned back 3 hours)
        future_issued_at = (now + timedelta(hours=3)).isoformat()

        lease = create_signed_lease(
            priv, key_id,
            machine_fingerprint=hw_fp,
            issued_at=future_issued_at
        )
        res = verify_station_lease(lease, expected_fingerprint=hw_fp, trusted_public_keys=keyring)

        assert res["is_valid"] is False
        assert res["status"] == "CLOCK_ANOMALY"
        assert res["mode"] == "DEGRADED"
        assert res["safety_monitoring_active"] is True


class TestSafetyEvidenceAndCoexistenceEndpoints:

    def test_emergency_safety_evidence_package_export(self):
        """Tests that the local-only safety evidence ZIP package generates successfully."""
        client = TestClient(app)
        res = client.get("/api/incidents/export-safety-package")

        assert res.status_code == 200
        assert res.headers["content-type"] == "application/zip"
        assert "SentinelX_Safety_Evidence_" in res.headers["content-disposition"]

        # Validate that the downloaded payload is a valid readable zip file
        zip_buf = io.BytesIO(res.content)
        with zipfile.ZipFile(zip_buf, "r") as zf:
            namelist = zf.namelist()
            assert "safety_incidents_audit_log.csv" in namelist
            csv_content = zf.read("safety_incidents_audit_log.csv").decode("utf-8")
            assert "Incident ID,Timestamp,Camera ID" in csv_content

    def test_station_fingerprint_api(self):
        """Tests that /api/license/station-fingerprint returns non-empty hardware fingerprint."""
        client = TestClient(app)
        res = client.get("/api/license/station-fingerprint")

        assert res.status_code == 200
        data = res.json()
        assert "machine_fingerprint" in data
        assert len(data["machine_fingerprint"]) == 64  # SHA-256 hex string

    def test_dual_mode_license_status_resolution(self, ed25519_keypair, tmp_path, monkeypatch):
        """Tests that v2 Ed25519 lease takes priority and legacy HMAC is marked as deprecated."""
        priv, pub_bytes, key_id, keyring = ed25519_keypair
        hw_fp = compute_machine_fingerprint()

        # Temporary paths
        test_lease_file = os.path.join(tmp_path, "sentinelx_lease.json")
        test_legacy_file = os.path.join(tmp_path, "sentinelx_license.json")
        monkeypatch.setattr("backend.services.license_service.STATION_LEASE_FILE_PATH", test_lease_file)
        monkeypatch.setattr("backend.services.license_service.LICENSE_FILE_PATH", test_legacy_file)
        monkeypatch.setattr("backend.auth.station_lease_verifier.TRUSTED_STATION_PUBLIC_KEYS", keyring)

        # 1. Neither exists -> UNLICENSED
        status1 = get_current_license_status()
        assert status1["status"] == "UNLICENSED"
        assert status1["safety_monitoring_active"] is True
        assert status1["license_format"] is None

        # 2. Add v2 Ed25519 lease -> V2_ED25519_LEASE
        lease = create_signed_lease(priv, key_id, machine_fingerprint=hw_fp)
        with open(test_lease_file, "w", encoding="utf-8") as f:
            json.dump(lease, f)

        status2 = get_current_license_status()
        assert status2["status"] == "ACTIVE_VALID"
        assert status2["is_licensed"] is True
        assert status2["license_format"] == "V2_ED25519_LEASE"

        # 3. If v2 lease is removed and legacy exists -> LEGACY_V1_HMAC_DEPRECATED
        os.remove(test_lease_file)
        # Create dummy legacy file with broken token
        with open(test_legacy_file, "w", encoding="utf-8") as f:
            json.dump({"token": "invalid.legacy.token"}, f)

        status3 = get_current_license_status()
        assert status3["license_format"] == "LEGACY_V1_HMAC_DEPRECATED"
        assert status3["status"] == "DEGRADED_SAFETY_MODE"
        assert status3["safety_monitoring_active"] is True
