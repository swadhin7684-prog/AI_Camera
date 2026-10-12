import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from backend.paths import LICENSE_FILE_PATH
from backend.database.admin_db import (
    get_company_by_id,
    get_company_by_license_key,
    create_signed_token,
    verify_signed_token,
    check_and_update_expiry,
    log_admin_action
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

def get_current_license_status() -> Dict[str, Any]:
    """
    Evaluates current local application license status:
    1. Checks local license file.
    2. Validates cryptographic signature.
    3. Checks dynamic expiry and online database if available.
    4. Applies 7-day offline grace period if network/server is unreachable.
    """
    if not os.path.exists(LICENSE_FILE_PATH):
        return {
            "is_licensed": False,
            "status": "UNLICENSED",
            "message": "No active license found. Please activate your company account.",
            "company": None
        }

    try:
        with open(LICENSE_FILE_PATH, "r", encoding="utf-8") as f:
            local_record = json.load(f)
    except Exception as e:
        logger.warning(f"Could not read local license file: {e}")
        return {
            "is_licensed": False,
            "status": "INVALID",
            "message": "License file is corrupted. Please re-activate.",
            "company": None
        }

    token_str = local_record.get("token")
    verified_payload = verify_signed_token(token_str)

    if not verified_payload:
        return {
            "is_licensed": False,
            "status": "TAMPERED",
            "message": "Cryptographic signature validation failed. License may have been altered.",
            "company": None
        }

    company_id = verified_payload.get("company_id")
    # Attempt to sync with local admin db (or remote service when configured)
    online_company = get_company_by_id(company_id)
    now = datetime.now(timezone.utc)

    if online_company:
        status = online_company["license_status"]
        expiry_dt = datetime.fromisoformat(online_company["license_expiry"].replace("Z", "+00:00"))
        if status == "SUSPENDED":
            return {
                "is_licensed": False,
                "status": "SUSPENDED",
                "message": "Company account is suspended by SentinelX Admin.",
                "company": online_company
            }
        if status == "EXPIRED" or now > expiry_dt:
            return {
                "is_licensed": False,
                "status": "EXPIRED",
                "message": f"License expired on {online_company['license_expiry'][:10]}. Monitoring is paused.",
                "company": online_company
            }
        return {
            "is_licensed": True,
            "status": "ACTIVE",
            "message": "License is active and verified.",
            "company": online_company
        }

    # Offline evaluation using verified token
    expiry_str = verified_payload.get("license_expiry", "")
    try:
        expiry_dt = datetime.fromisoformat(expiry_str.replace("Z", "+00:00"))
        last_verified_str = verified_payload.get("last_verified_at", "")
        last_verified_dt = datetime.fromisoformat(last_verified_str.replace("Z", "+00:00"))
        
        # Check overall license expiry
        if now > expiry_dt:
            return {
                "is_licensed": False,
                "status": "EXPIRED",
                "message": f"License expired on {expiry_str[:10]}.",
                "company": verified_payload
            }
            
        # Check offline grace period (7 days)
        if now > last_verified_dt + timedelta(days=GRACE_PERIOD_DAYS):
            return {
                "is_licensed": False,
                "status": "GRACE_EXPIRED",
                "message": f"Offline grace period of {GRACE_PERIOD_DAYS} days expired. Please connect to internet to verify license.",
                "company": verified_payload
            }

        return {
            "is_licensed": True,
            "status": "OFFLINE_ACTIVE",
            "message": f"Operating in offline grace mode (Expires {expiry_str[:10]}).",
            "company": verified_payload
        }
    except Exception as e:
        logger.error(f"Error evaluating offline license: {e}")
        return {
            "is_licensed": False,
            "status": "INVALID",
            "message": "Failed to parse license date.",
            "company": None
        }
