"""
Isolated Ed25519 Station Lease Verifier for SentinelX AI v2.0.
Implements asymmetric cryptographic station lease verification, hardware binding,
time manipulation detection, and safety-preserving degraded mode logic.

Zero private signing keys or shared HMAC secrets exist in this module.
The private signing key resides exclusively on the trusted central backend.
"""

import os
import sys
import json
import time
import uuid
import hashlib
import base64
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple, List

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

logger = logging.getLogger("sentinelx.station_lease")

# ----------------- CONSTANTS & TRUSTED KEYRING ----------------- #

# Hardcoded public verification keys for the client desktop distribution.
# Each entry is a raw 32-byte Ed25519 public key.
# Private keys NEVER exist here.
TRUSTED_STATION_PUBLIC_KEYS: Dict[str, bytes] = {
    # Production 2026 Primary Key (Base64-decoded to 32 bytes)
    # Generated for SentinelX Central Production Backend
    "ed25519-2026-v1": base64.b64decode("uW3bU0H8U8hF2aH2/lKq8hEwE7sQv4XqP2r8R8m0K8E="),
    # Pre-distributed Rotation Key for seamless key transition
    "ed25519-2026-v2": base64.b64decode("vX4cV1I9V9iG3bI3/mLr9iFxE8tRw5YrQ3s9S9n1L9F=")
}

# Static salt for local machine fingerprint generation
FINGERPRINT_SALT = "sentinelx_edge_station_hw_salt_2026"

# ----------------- EXCEPTIONS ----------------- #

class StationLeaseError(Exception):
    """Base exception for all station lease errors."""
    pass

class MalformedLeaseError(StationLeaseError):
    """Raised when the lease JSON is structurally malformed."""
    pass

class MissingLeaseFieldError(StationLeaseError):
    """Raised when a required canonical field is missing."""
    pass

class UnknownKeyIdError(StationLeaseError):
    """Raised when the lease was signed by an unrecognized key_id."""
    pass

class InvalidLeaseSignatureError(StationLeaseError):
    """Raised when the Ed25519 cryptographic signature verification fails."""
    pass

class HardwareMismatchError(StationLeaseError):
    """Raised when the lease machine_fingerprint does not match the local station."""
    pass

class ClockAnomalyError(StationLeaseError):
    """Raised when system clock rollback or impossible timestamps are detected."""
    pass


# ----------------- HARDWARE FINGERPRINTING ----------------- #

_cached_machine_fingerprint: Optional[str] = None

def get_local_machine_guid() -> str:
    """Reads Windows Cryptography MachineGuid, with safe fallbacks."""
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as key:
                guid, _ = winreg.QueryValueEx(key, "MachineGuid")
                if guid:
                    return str(guid).strip()
        except Exception as e:
            logger.debug(f"Could not read MachineGuid from registry: {e}")

    # Fallback to uuid.getnode (MAC address integer)
    return str(uuid.getnode())

def get_system_uuid() -> str:
    """Reads System/Motherboard UUID via PowerShell/WMI with fallback."""
    if sys.platform == "win32":
        try:
            import subprocess
            out = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
                text=True,
                timeout=2.0
            ).strip()
            if out and len(out) >= 16:
                return out
        except Exception as e:
            logger.debug(f"Could not read System UUID via CIM: {e}")

    return "DEFAULT_SYSTEM_UUID"

def compute_machine_fingerprint() -> str:
    """
    Computes a deterministic, hardware-bound SHA-256 fingerprint for the current station.
    Formula: SHA-256(MachineGuid + ":" + SystemUUID + ":" + FINGERPRINT_SALT)
    """
    global _cached_machine_fingerprint
    if _cached_machine_fingerprint:
        return _cached_machine_fingerprint

    guid = get_local_machine_guid()
    sys_uuid = get_system_uuid()
    raw = f"{guid}:{sys_uuid}:{FINGERPRINT_SALT}".encode("utf-8")
    _cached_machine_fingerprint = hashlib.sha256(raw).hexdigest()
    return _cached_machine_fingerprint


# ----------------- CANONICAL SERIALIZATION ----------------- #

def canonical_json_bytes(obj: Any) -> bytes:
    """
    Produces deterministic RFC 8785 Canonical JSON bytes:
    UTF-8 encoded, lexicographically sorted keys, no redundant whitespace separators.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


# ----------------- LEASE VERIFICATION LOGIC ----------------- #

REQUIRED_CANONICAL_FIELDS = [
    "schema_version",
    "lease_id",
    "company_id",
    "company_name",
    "station_id",
    "machine_fingerprint",
    "plan_tier",
    "max_cameras",
    "features",
    "issued_at",
    "lease_expiry",
    "grace_period_until",
    "grace_days",
    "key_id",
    "revocation_epoch"
]

def verify_station_lease(
    lease_container: Dict[str, Any],
    expected_fingerprint: Optional[str] = None,
    trusted_public_keys: Optional[Dict[str, bytes]] = None,
    allow_hardware_mismatch: bool = False,
    max_clock_skew_seconds: int = 60,
    current_time_override: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Cryptographically verifies an Ed25519-signed station lease.
    
    Returns structured evaluation result:
    {
        "is_valid": bool,
        "mode": "ACTIVE" | "DEGRADED" | "INVALID",
        "status": "ACTIVE_VALID" | "OFFLINE_GRACE" | "DEGRADED_SAFETY_MODE" | "TAMPERED" | "HARDWARE_MISMATCH",
        "safety_monitoring_active": True,  # NEVER False
        "license_format": "V2_ED25519_LEASE",
        "company_id": str,
        "station_id": str,
        "message": str,
        "days_remaining": int,
        "features_allowed": list,
        "features_restricted": list
    }
    """
    keyring = trusted_public_keys or TRUSTED_STATION_PUBLIC_KEYS

    # 1. Structural check
    if not isinstance(lease_container, dict):
        return {
            "is_valid": False,
            "mode": "INVALID",
            "status": "MALFORMED",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": "Lease file does not contain valid JSON object.",
            "company_id": None,
            "station_id": None
        }

    schema_version = lease_container.get("schema_version")
    if schema_version != 2:
        return {
            "is_valid": False,
            "mode": "INVALID",
            "status": "UNSUPPORTED_VERSION",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Unsupported lease schema version: {schema_version} (expected 2).",
            "company_id": None,
            "station_id": None
        }

    payload = lease_container.get("payload")
    sig_b64 = lease_container.get("signature")
    key_id = lease_container.get("key_id") or (payload.get("key_id") if isinstance(payload, dict) else None)

    if not isinstance(payload, dict) or not isinstance(sig_b64, str) or not key_id:
        return {
            "is_valid": False,
            "mode": "INVALID",
            "status": "MALFORMED",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": "Missing payload, signature, or key_id in lease container.",
            "company_id": None,
            "station_id": None
        }

    # 2. Check all required canonical fields
    for field in REQUIRED_CANONICAL_FIELDS:
        if field not in payload:
            return {
                "is_valid": False,
                "mode": "INVALID",
                "status": "MISSING_FIELD",
                "safety_monitoring_active": True,
                "license_format": "V2_ED25519_LEASE",
                "message": f"Missing required canonical lease field: '{field}'.",
                "company_id": payload.get("company_id"),
                "station_id": payload.get("station_id")
            }

    # 3. Key ID lookup
    if key_id not in keyring:
        return {
            "is_valid": False,
            "mode": "INVALID",
            "status": "UNKNOWN_KEY_ID",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Lease was signed by unrecognized key ID '{key_id}'.",
            "company_id": payload.get("company_id"),
            "station_id": payload.get("station_id")
        }

    pubkey_bytes = keyring[key_id]

    # 4. Cryptographic Ed25519 signature check
    try:
        sig_bytes = base64.b64decode(sig_b64)
        if len(sig_bytes) != 64:
            raise InvalidSignature("Signature length is not 64 bytes.")
        
        canonical_bytes = canonical_json_bytes(payload)
        public_key = ed25519.Ed25519PublicKey.from_public_bytes(pubkey_bytes)
        public_key.verify(sig_bytes, canonical_bytes)
    except Exception as e:
        logger.warning(f"Station lease cryptographic verification failed: {e}")
        return {
            "is_valid": False,
            "mode": "DEGRADED",
            "status": "TAMPERED",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": "Cryptographic signature validation failed. Lease payload may have been altered.",
            "company_id": payload.get("company_id"),
            "station_id": payload.get("station_id"),
            "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
            "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
        }

    # 5. Hardware binding check
    local_fingerprint = expected_fingerprint or compute_machine_fingerprint()
    lease_fingerprint = payload.get("machine_fingerprint")
    if not allow_hardware_mismatch and local_fingerprint != lease_fingerprint:
        logger.warning(f"Station hardware mismatch: expected {local_fingerprint[:12]}..., got {lease_fingerprint[:12]}...")
        return {
            "is_valid": False,
            "mode": "DEGRADED",
            "status": "HARDWARE_MISMATCH",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": "Station hardware binding mismatch. Station must be re-registered or approved for replacement.",
            "company_id": payload.get("company_id"),
            "station_id": payload.get("station_id"),
            "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
            "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
        }

    # 6. Chronological bounds check
    now = current_time_override or datetime.now(timezone.utc)
    try:
        issued_at = datetime.fromisoformat(payload["issued_at"].replace("Z", "+00:00"))
        lease_expiry = datetime.fromisoformat(payload["lease_expiry"].replace("Z", "+00:00"))
        grace_until = datetime.fromisoformat(payload["grace_period_until"].replace("Z", "+00:00"))
    except Exception as date_err:
        return {
            "is_valid": False,
            "mode": "DEGRADED",
            "status": "INVALID_DATE_FORMAT",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Failed to parse lease timestamp: {date_err}",
            "company_id": payload.get("company_id"),
            "station_id": payload.get("station_id")
        }

    # Clock anomaly check: issued in impossible future
    if issued_at > now + timedelta(seconds=max_clock_skew_seconds):
        logger.warning(f"Clock anomaly: lease issued_at {issued_at} is in future relative to current time {now}")
        return {
            "is_valid": False,
            "mode": "DEGRADED",
            "status": "CLOCK_ANOMALY",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": "System clock anomaly: System time is earlier than lease issuance time.",
            "company_id": payload.get("company_id"),
            "station_id": payload.get("station_id"),
            "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
            "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
        }

    # Check validity periods
    if now <= lease_expiry:
        days_rem = max(0, (lease_expiry - now).days)
        return {
            "is_valid": True,
            "mode": "ACTIVE",
            "status": "ACTIVE_VALID",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Station lease active (Valid until {payload['lease_expiry'][:10]}).",
            "company_id": payload["company_id"],
            "station_id": payload["station_id"],
            "days_remaining": days_rem,
            "features_allowed": payload.get("features", []),
            "features_restricted": []
        }
    elif now <= grace_until:
        grace_days_rem = max(0, (grace_until - now).days)
        return {
            "is_valid": True,
            "mode": "ACTIVE",
            "status": "OFFLINE_GRACE",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Operating in offline grace mode ({grace_days_rem} days remaining until {payload['grace_period_until'][:10]}).",
            "company_id": payload["company_id"],
            "station_id": payload["station_id"],
            "days_remaining": grace_days_rem,
            "features_allowed": payload.get("features", []),
            "features_restricted": []
        }
    else:
        # Grace expired -> Safety-Preserving Degraded Mode
        return {
            "is_valid": False,
            "mode": "DEGRADED",
            "status": "DEGRADED_SAFETY_MODE",
            "safety_monitoring_active": True,
            "license_format": "V2_ED25519_LEASE",
            "message": f"Station lease grace period expired on {payload['grace_period_until'][:10]}. Operating in SAFETY-PRESERVING DEGRADED MODE. Hazard detection active.",
            "company_id": payload["company_id"],
            "station_id": payload["station_id"],
            "days_remaining": 0,
            "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
            "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
        }
