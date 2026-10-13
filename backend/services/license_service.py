import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from backend.paths import LICENSE_FILE_PATH, STATION_LEASE_FILE_PATH
from backend.auth.station_lease_verifier import (
    verify_station_lease,
    compute_machine_fingerprint
)
from backend.database.admin_db import (
    get_company_by_id,
    get_company_by_license_key,
    create_signed_token,
    verify_signed_token,
    check_and_update_expiry,
    log_admin_action,
    create_company_account,
    update_company_details
)

logger = logging.getLogger("sentinelx.license")

GRACE_PERIOD_DAYS = 7

def issue_company_license_token(company_id: str) -> Optional[str]:
    """Issues a cryptographically signed license token for a company."""
    company = get_company_by_id(company_id)
    if not company:
        return None

    # Token payload with verification timestamp and expiry
    now = datetime.now(timezone.utc)
    payload = {
        "company_id": company["company_id"],
        "name": company["name"],
        "plan_type": company["plan_type"],
        "license_key": company["license_key"],
        "license_status": company["license_status"],
        "license_expiry": company["license_expiry"],
        "last_verified_at": now.isoformat(),
        "grace_days": GRACE_PERIOD_DAYS
    }
    # Token valid for 30 days before mandatory re-validation
    return create_signed_token(payload, expires_in_seconds=30 * 86400)

def activate_cloud_company_license(company_data: Dict[str, Any]) -> Dict[str, Any]:
    """Syncs a cloud-verified Firebase Firestore company license into local SQLite and activates it."""
    company_id = company_data.get("company_id")
    license_key = company_data.get("license_key")
    if not company_id or not license_key:
        return {"success": False, "message": "Missing company_id or license_key in cloud payload."}

    # If company does not exist in local DB, create record
    existing = get_company_by_id(company_id)
    if not existing:
        try:
            create_company_account(
                company_id=company_id,
                name=company_data.get("name", "Company"),
                contact_email=company_data.get("contact_email", "contact@company.com"),
                contact_phone=company_data.get("contact_phone", ""),
                address=company_data.get("address", ""),
                plan_type=company_data.get("plan_type", "Enterprise"),
                max_users=company_data.get("max_users", 5),
                license_key=license_key,
                validity_days=365,
                actor_admin_id="FIREBASE_CLOUD_SYNC"
            )
        except Exception as e:
            logger.warning(f"Note on creating local company during sync: {e}")

    # Ensure status and expiry match cloud record
    update_company_details(company_id, {
        "license_expiry": company_data.get("license_expiry"),
        "license_status": company_data.get("license_status", "ACTIVE")
    }, actor_admin_id="FIREBASE_CLOUD_SYNC")

    return activate_company_license(company_id, license_key)

def activate_company_license(company_id: str, license_key: str) -> Dict[str, Any]:
    """Activates the local application using provided company credentials."""
    company = get_company_by_id(company_id)
    if not company:
        return {
            "success": False,
            "message": "Company ID not found. Please contact your SentinelX Administrator."
        }

    if company["license_key"].strip() != license_key.strip():
        return {
            "success": False,
            "message": "Invalid License Key for this Company ID."
        }

    if company["license_status"] == "SUSPENDED":
        return {
            "success": False,
            "message": "This company account has been suspended by the SentinelX Administrator."
        }

    if company["license_status"] == "EXPIRED":
        return {
            "success": False,
            "message": f"This license expired on {company['license_expiry'][:10]}. Please renew your subscription."
        }

    token = issue_company_license_token(company_id)
    if not token:
        return {
            "success": False,
            "message": "Failed to generate signed license token."
        }

    # Store license token locally
    license_record = {
        "company_id": company["company_id"],
        "company_name": company["name"],
        "plan_type": company["plan_type"],
        "license_key": company["license_key"],
        "license_status": company["license_status"],
        "license_expiry": company["license_expiry"],
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "token": token
    }

    try:
        os.makedirs(os.path.dirname(LICENSE_FILE_PATH), exist_ok=True)
        with open(LICENSE_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(license_record, f, indent=2)
        logger.info(f"License successfully activated and stored for {company_id}.")
    except Exception as e:
        logger.error(f"Failed to persist license file: {e}")

    log_admin_action(
        action="LICENSE_ACTIVATED",
        actor_admin_id="CLIENT",
        target_type="COMPANY",
        target_id=company_id,
        details="Company successfully activated SentinelX AI on local machine"
    )

    return {
        "success": True,
        "message": f"License successfully activated for {company['name']}.",
        "company": {
            "company_id": company["company_id"],
            "name": company["name"],
            "plan_type": company["plan_type"],
            "license_status": company["license_status"],
            "license_expiry": company["license_expiry"]
        }
    }

def activate_station_lease(lease_container: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates and persists an Ed25519-signed v2.0 station lease locally.
    Does not allow storing completely tampered or malformed leases.
    """
    verification = verify_station_lease(lease_container)
    if verification.get("status") in ["MALFORMED", "UNSUPPORTED_VERSION", "MISSING_FIELD", "UNKNOWN_KEY_ID"]:
        return {
            "success": False,
            "message": verification.get("message", "Invalid lease container format.")
        }

    try:
        os.makedirs(os.path.dirname(STATION_LEASE_FILE_PATH), exist_ok=True)
        with open(STATION_LEASE_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(lease_container, f, indent=2)
        logger.info(f"Ed25519 Station lease stored: station={verification.get('station_id')}, status={verification.get('status')}")
    except Exception as e:
        logger.error(f"Failed to persist station lease: {e}")
        return {"success": False, "message": f"Failed to persist lease file: {e}"}

    log_admin_action(
        action="STATION_LEASE_ACTIVATED",
        actor_admin_id="STATION_CLIENT",
        target_type="STATION",
        target_id=verification.get("station_id") or "UNKNOWN",
        details=f"Station lease registered. Status: {verification.get('status')}"
    )

    return {
        "success": True,
        "message": verification.get("message", "Station lease registered successfully."),
        "lease": verification
    }

def get_current_license_status() -> Dict[str, Any]:
    """
    Evaluates current local application license status with strict priority:
    1. v2.0 Asymmetric Ed25519 Station Lease (sentinelx_lease.json)
    2. Legacy v1.1 HMAC Token (sentinelx_license.json - explicitly marked deprecated)
    3. Unlicensed standalone mode

    SAFETY INVARIANT:
    Safety-critical hazard monitoring (CCTV capture, PPE inference, audible alarms,
    local incident logging, emergency evidence export) is NEVER halted by licensing status.
    """
    # ---------------- 1. Check v2.0 Station Lease First ---------------- #
    if os.path.exists(STATION_LEASE_FILE_PATH):
        try:
            with open(STATION_LEASE_FILE_PATH, "r", encoding="utf-8") as f:
                lease_data = json.load(f)
            v2_res = verify_station_lease(lease_data)
            
            # Map v2 verification result to application status
            is_active = v2_res.get("status") in ["ACTIVE_VALID", "OFFLINE_GRACE"]
            return {
                "is_licensed": is_active,
                "is_degraded": not is_active,
                "status": v2_res.get("status"),
                "mode": v2_res.get("mode"),
                "safety_monitoring_active": True,
                "license_format": "V2_ED25519_LEASE",
                "message": v2_res.get("message"),
                "company": {
                    "company_id": v2_res.get("company_id"),
                    "station_id": v2_res.get("station_id")
                },
                "days_remaining": v2_res.get("days_remaining", 0),
                "features_allowed": v2_res.get("features_allowed", []),
                "features_restricted": v2_res.get("features_restricted", [])
            }
        except Exception as e:
            logger.warning(f"Error reading v2 station lease: {e}")

    # ---------------- 2. Fallback to Legacy v1.1 HMAC License ---------------- #
    if os.path.exists(LICENSE_FILE_PATH):
        try:
            with open(LICENSE_FILE_PATH, "r", encoding="utf-8") as f:
                local_record = json.load(f)
            token_str = local_record.get("token")
            verified_payload = verify_signed_token(token_str)
            
            if not verified_payload:
                return {
                    "is_licensed": False,
                    "is_degraded": True,
                    "status": "DEGRADED_SAFETY_MODE",
                    "mode": "DEGRADED",
                    "safety_monitoring_active": True,
                    "license_format": "LEGACY_V1_HMAC_DEPRECATED",
                    "message": "Cryptographic signature validation failed on legacy license. Operating in SAFETY-PRESERVING DEGRADED MODE.",
                    "company": None,
                    "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
                    "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
                }

            company_id = verified_payload.get("company_id")
            online_company = get_company_by_id(company_id)
            now = datetime.now(timezone.utc)

            if online_company:
                status = online_company["license_status"]
                expiry_dt = datetime.fromisoformat(online_company["license_expiry"].replace("Z", "+00:00"))
                if status == "SUSPENDED" or status == "EXPIRED" or now > expiry_dt:
                    return {
                        "is_licensed": False,
                        "is_degraded": True,
                        "status": "DEGRADED_SAFETY_MODE",
                        "mode": "DEGRADED",
                        "safety_monitoring_active": True,
                        "license_format": "LEGACY_V1_HMAC_DEPRECATED",
                        "message": f"Legacy license expired on {online_company['license_expiry'][:10]}. Operating in SAFETY-PRESERVING DEGRADED MODE. Hazard detection active.",
                        "company": online_company,
                        "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
                        "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
                    }
                return {
                    "is_licensed": True,
                    "is_degraded": False,
                    "status": "ACTIVE",
                    "mode": "ACTIVE",
                    "safety_monitoring_active": True,
                    "license_format": "LEGACY_V1_HMAC_DEPRECATED",
                    "message": "Legacy v1.1 HMAC license active (Deprecated - Please upgrade to v2.0 Station Lease).",
                    "company": online_company,
                    "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
                    "features_restricted": []
                }

            # Offline legacy evaluation
            expiry_str = verified_payload.get("license_expiry", "")
            expiry_dt = datetime.fromisoformat(expiry_str.replace("Z", "+00:00"))
            last_verified_str = verified_payload.get("last_verified_at", "")
            last_verified_dt = datetime.fromisoformat(last_verified_str.replace("Z", "+00:00"))
            
            if now > expiry_dt or now > last_verified_dt + timedelta(days=GRACE_PERIOD_DAYS):
                return {
                    "is_licensed": False,
                    "is_degraded": True,
                    "status": "DEGRADED_SAFETY_MODE",
                    "mode": "DEGRADED",
                    "safety_monitoring_active": True,
                    "license_format": "LEGACY_V1_HMAC_DEPRECATED",
                    "message": f"Legacy license expired or offline grace elapsed. Operating in SAFETY-PRESERVING DEGRADED MODE. Hazard detection active.",
                    "company": verified_payload,
                    "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
                    "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
                }

            return {
                "is_licensed": True,
                "is_degraded": False,
                "status": "OFFLINE_ACTIVE",
                "mode": "ACTIVE",
                "safety_monitoring_active": True,
                "license_format": "LEGACY_V1_HMAC_DEPRECATED",
                "message": f"Operating in offline legacy mode (Expires {expiry_str[:10]}).",
                "company": verified_payload,
                "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
                "features_restricted": []
            }
        except Exception as e:
            logger.warning(f"Error parsing legacy license: {e}")

    # ---------------- 3. Unlicensed Standalone Fallback ---------------- #
    return {
        "is_licensed": False,
        "is_degraded": True,
        "status": "UNLICENSED",
        "mode": "STANDALONE",
        "safety_monitoring_active": True,
        "license_format": None,
        "message": "No active station license found. Camera inferencing operates in local standalone mode.",
        "company": None,
        "features_allowed": ["cctv_capture", "ppe_inference", "audio_alarm", "local_incident_log", "emergency_evidence_export"],
        "features_restricted": ["worker_enrollment", "zone_editing", "cloud_sync", "executive_pdf_reports"]
    }
