from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import time
import logging

from backend.database.admin_db import (
    get_super_admin_by_email_or_username,
    verify_password,
    record_super_admin_login,
    create_signed_token,
    verify_signed_token,
    create_company_account,
    get_company_by_id,
    list_companies,
    update_company_status,
    update_company_details,
    get_admin_dashboard_metrics,
    get_audit_logs,
    log_admin_action,
    count_super_admins,
    create_super_admin
)
from backend.services.license_service import (
    activate_company_license,
    get_current_license_status,
    issue_company_license_token
)

logger = logging.getLogger("sentinelx.admin_routes")
router = APIRouter(prefix="/api/admin", tags=["Super Admin & Licensing"])
license_router = APIRouter(prefix="/api/license", tags=["Company Licensing"])

# In-memory IP rate limiter for authentication: max 5 failed attempts per 60s
failed_login_attempts: Dict[str, List[float]] = {}

def check_login_rate_limit(ip: str):
    now = time.time()
    attempts = [t for t in failed_login_attempts.get(ip, []) if now - t < 60]
    failed_login_attempts[ip] = attempts
    if len(attempts) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait 60 seconds before trying again."
        )

def record_failed_login(ip: str):
    now = time.time()
    if ip not in failed_login_attempts:
        failed_login_attempts[ip] = []
    failed_login_attempts[ip].append(now)

# Auth dependency
async def require_super_admin(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Administrative authorization required.")
    
    token = authorization.replace("Bearer ", "").strip()
    data = verify_signed_token(token)
    if not data or data.get("role") != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Invalid or expired administrative credentials.")
    return data

# ==================== PYDANTIC SCHEMAS ====================

class AdminLoginRequest(BaseModel):
    username_or_email: str
    password: str

class CreateCompanyRequest(BaseModel):
    name: str
    contact_email: str
    contact_phone: Optional[str] = ""
    address: Optional[str] = ""
    plan_type: Optional[str] = "Enterprise"
    max_users: Optional[int] = 5
    validity_days: Optional[int] = 365

class UpdateCompanyStatusRequest(BaseModel):
    status: str

class UpdateCompanyDetailsRequest(BaseModel):
    name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    plan_type: Optional[str] = None
    max_users: Optional[int] = None
    license_expiry: Optional[str] = None

class RenewLicenseRequest(BaseModel):
    extend_days: int = 365

class ActivateLicenseRequest(BaseModel):
    company_id: str
    license_key: str

class InitialSetupRequest(BaseModel):
    username: str
    email: str
    password: str
    setup_key: str

# ==================== SUPER ADMIN AUTH ENDPOINTS ====================

@router.get("/auth/setup-status")
async def get_setup_status():
    """Checks whether an initial Super Admin account has been provisioned."""
    count = count_super_admins()
    return {"is_initialized": count > 0, "admin_count": count}

@router.post("/auth/setup")
async def initial_super_admin_setup(req: InitialSetupRequest, request: Request):
    """Initial provisioning endpoint for the very first Super Admin account."""
    if count_super_admins() > 0:
        raise HTTPException(status_code=400, detail="Super Admin is already provisioned.")
    
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    client_ip = request.client.host if request.client else "127.0.0.1"
    admin = create_super_admin(req.username, req.email, req.password)
    log_admin_action("FIRST_ADMIN_PROVISIONED", admin["admin_id"], "AUTH", admin["admin_id"], "Initial setup", client_ip)
    return {"success": True, "message": "Super Admin successfully initialized.", "admin": admin}

@router.post("/auth/login")
async def super_admin_login(req: AdminLoginRequest, request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    check_login_rate_limit(client_ip)

    admin = get_super_admin_by_email_or_username(req.username_or_email)
    if not admin or not verify_password(req.password, admin["password_hash"], admin["salt"]):
        record_failed_login(client_ip)
        log_admin_action("LOGIN_FAILED", "ANONYMOUS", "AUTH", req.username_or_email, "Invalid credentials", client_ip)
        raise HTTPException(status_code=401, detail="Invalid username/email or password.")

    # Record successful login
    record_super_admin_login(admin["admin_id"])
    token = create_signed_token({
        "sub": admin["admin_id"],
        "username": admin["username"],
        "email": admin["email"],
        "role": "SUPER_ADMIN"
    }, expires_in_seconds=43200) # 12 hours session

    log_admin_action("LOGIN_SUCCESS", admin["admin_id"], "AUTH", admin["admin_id"], "Successful login", client_ip)

    return {
        "success": True,
        "token": token,
        "admin": {
            "admin_id": admin["admin_id"],
            "username": admin["username"],
            "email": admin["email"],
            "role": admin["role"],
            "last_login": admin.get("last_login")
        }
    }

@router.get("/auth/me")
async def get_current_admin(admin: Dict[str, Any] = Depends(require_super_admin)):
    return {"admin": admin}

@router.post("/auth/logout")
async def super_admin_logout(admin: Dict[str, Any] = Depends(require_super_admin)):
    log_admin_action("LOGOUT", admin["sub"], "AUTH", admin["sub"], "Administrator logged out")
    return {"success": True, "message": "Logged out successfully."}

# ==================== SUPER ADMIN DASHBOARD & COMPANIES ====================

@router.get("/dashboard")
async def get_dashboard(admin: Dict[str, Any] = Depends(require_super_admin)):
    return get_admin_dashboard_metrics()

@router.get("/companies")
async def get_companies(
    status: Optional[str] = None,
    search: Optional[str] = None,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    companies = list_companies(status_filter=status, search_query=search)
    return {"companies": companies, "count": len(companies)}

@router.post("/companies")
async def create_company(
    req: CreateCompanyRequest,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Company name is required.")
    if not req.contact_email.strip() or "@" not in req.contact_email:
        raise HTTPException(status_code=400, detail="Valid contact email is required.")

    company = create_company_account(
        name=req.name,
        contact_email=req.contact_email,
        contact_phone=req.contact_phone or "",
        address=req.address or "",
        plan_type=req.plan_type or "Enterprise",
        max_users=req.max_users or 5,
        validity_days=req.validity_days or 365,
        actor_admin_id=admin["sub"]
    )
    return {"success": True, "company": company}

@router.get("/companies/{company_id}")
async def get_company(
    company_id: str,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    company = get_company_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"company": company}

@router.patch("/companies/{company_id}/status")
async def change_company_status(
    company_id: str,
    req: UpdateCompanyStatusRequest,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    company = get_company_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    try:
        updated = update_company_status(company_id, req.status, actor_admin_id=admin["sub"])
        return {"success": True, "company": updated}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/companies/{company_id}")
async def edit_company(
    company_id: str,
    req: UpdateCompanyDetailsRequest,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    company = get_company_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = update_company_details(company_id, updates, actor_admin_id=admin["sub"])
    return {"success": True, "company": updated}

@router.post("/companies/{company_id}/license/renew")
async def renew_company_license(
    company_id: str,
    req: RenewLicenseRequest,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    company = get_company_by_id(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    now = datetime.now(timezone.utc)
    try:
        current_exp = datetime.fromisoformat(company["license_expiry"].replace("Z", "+00:00"))
        # If currently active, extend from current expiry, else extend from now
        base_date = current_exp if current_exp > now else now
    except Exception:
        base_date = now

    new_expiry = (base_date + timedelta(days=req.extend_days)).isoformat()
    updated = update_company_details(
        company_id,
        {"license_expiry": new_expiry, "license_status": "ACTIVE"},
        actor_admin_id=admin["sub"]
    )
    
    # Issue fresh token
    new_token = issue_company_license_token(company_id)
    return {"success": True, "company": updated, "token": new_token}

@router.get("/audit-logs")
async def view_audit_logs(
    limit: int = 50,
    admin: Dict[str, Any] = Depends(require_super_admin)
):
    logs = get_audit_logs(limit=limit)
    return {"logs": logs, "count": len(logs)}

# ==================== COMPANY CLIENT LICENSING ENDPOINTS ====================

@license_router.get("/status")
async def check_local_license():
    """Returns the current company license status evaluated on the client machine."""
    return get_current_license_status()

@license_router.post("/activate")
async def activate_license(req: ActivateLicenseRequest):
    """Activates the local application using Company ID and License Key."""
    res = activate_company_license(req.company_id, req.license_key)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res
