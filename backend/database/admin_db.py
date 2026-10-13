import sqlite3
import os
import logging
import hashlib
import secrets
import hmac
import json
import base64
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from backend.paths import ADMIN_DB_PATH, ADMIN_SECRET_FILE, LICENSE_FILE_PATH

logger = logging.getLogger("sentinelx.admin_db")

def get_or_create_signing_secret() -> bytes:
    """Retrieves or safely generates a persistent signing secret for admin tokens and licenses."""
    if os.path.exists(ADMIN_SECRET_FILE):
        try:
            with open(ADMIN_SECRET_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if len(content) >= 32:
                    return content.encode("utf-8")
        except Exception as e:
            logger.warning(f"Could not read signing secret file: {e}")
    
    # Generate fresh cryptographically secure 256-bit secret
    new_secret = secrets.token_hex(32)
    try:
        os.makedirs(os.path.dirname(ADMIN_SECRET_FILE), exist_ok=True)
        with open(ADMIN_SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(new_secret)
    except Exception as e:
        logger.warning(f"Could not persist signing secret to file: {e}")
    return new_secret.encode("utf-8")

SIGNING_SECRET = get_or_create_signing_secret()

def get_admin_db_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(ADMIN_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(ADMIN_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> tuple[str, str]:
    """Generates PBKDF2-HMAC-SHA256 hash with unique 16-byte random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000)
    return key.hex(), salt

def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """Verifies candidate password in constant time."""
    try:
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000)
        return hmac.compare_digest(key.hex(), stored_hash)
    except Exception:
        return False

def create_signed_token(payload: Dict[str, Any], expires_in_seconds: int = 86400) -> str:
    """Creates a tamper-proof HMAC-SHA256 signed token."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=expires_in_seconds)
    token_data = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp())
    }
    encoded_payload = base64.urlsafe_b64encode(json.dumps(token_data).encode("utf-8")).decode("utf-8").rstrip("=")
    signature = hmac.new(SIGNING_SECRET, encoded_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{encoded_payload}.{signature}"

def verify_signed_token(token_str: str) -> Optional[Dict[str, Any]]:
    """Validates an HMAC-SHA256 signed token and checks expiration."""
    if not token_str or "." not in token_str:
        return None
    try:
        parts = token_str.strip().split(".")
        if len(parts) != 2:
            return None
        encoded_payload, signature = parts[0], parts[1]
        
        expected_sig = hmac.new(SIGNING_SECRET, encoded_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        
        padding = 4 - (len(encoded_payload) % 4)
        if padding != 4:
            encoded_payload += "=" * padding
        raw_json = base64.urlsafe_b64decode(encoded_payload.encode("utf-8")).decode("utf-8")
        data = json.loads(raw_json)
        
        now_ts = int(datetime.now(timezone.utc).timestamp())
        if "exp" in data and now_ts > data["exp"]:
            return None # Expired
        
        return data
    except Exception as e:
        logger.debug(f"Token verification error: {e}")
        return None

def init_admin_db():
    """Initializes the dedicated Super Admin and Company Licensing database schema."""
    conn = get_admin_db_connection()
    c = conn.cursor()

    # 1. Super Admins
    c.execute("""
        CREATE TABLE IF NOT EXISTS super_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT DEFAULT 'SUPER_ADMIN',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            last_login TEXT
        )
    """)

    # 2. Companies & Licensing
    c.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            contact_email TEXT NOT NULL,
            contact_phone TEXT,
            address TEXT,
            plan_type TEXT DEFAULT 'Enterprise',
            max_users INTEGER DEFAULT 5,
            license_status TEXT DEFAULT 'ACTIVE',
            license_key TEXT UNIQUE NOT NULL,
            license_start TEXT NOT NULL,
            license_expiry TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    # 3. Company Authorized Users
    c.execute("""
        CREATE TABLE IF NOT EXISTS company_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT DEFAULT 'COMPANY_ADMIN',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY (company_id) REFERENCES companies(company_id)
        )
    """)

    # 4. Audit Log
    c.execute("""
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor_admin_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL
        )
    """)

    conn.commit()
    conn.close()
    logger.info("SentinelX Super Admin database schema initialized.")

# ==================== SUPER ADMIN SERVICES ====================

def get_super_admin_by_email_or_username(identifier: str) -> Optional[Dict[str, Any]]:
    conn = get_admin_db_connection()
    c = conn.cursor()
    cleaned = identifier.strip()
    c.execute(
        "SELECT * FROM super_admins WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) AND is_active = 1",
        (cleaned, cleaned)
    )
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def record_super_admin_login(admin_id: str):
    conn = get_admin_db_connection()
    c = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    c.execute("UPDATE super_admins SET last_login = ? WHERE admin_id = ?", (now_iso, admin_id))
    conn.commit()
    conn.close()

def create_super_admin(username: str, email: str, password: str) -> Dict[str, Any]:
    init_admin_db()
    conn = get_admin_db_connection()
    c = conn.cursor()
    admin_id = f"ADM-{secrets.token_hex(4).upper()}"
    p_hash, salt = hash_password(password)
    now_iso = datetime.now(timezone.utc).isoformat()

    c.execute("""
        INSERT INTO super_admins (admin_id, username, email, password_hash, salt, role, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, 'SUPER_ADMIN', 1, ?)
    """, (admin_id, username.strip(), email.strip().lower(), p_hash, salt, now_iso))
    conn.commit()
    conn.close()

    log_admin_action(
        action="SUPER_ADMIN_CREATED",
        actor_admin_id=admin_id,
        target_type="ADMIN",
        target_id=admin_id,
        details=f"Created administrative account for {email}"
    )

    return {
        "admin_id": admin_id,
        "username": username,
        "email": email,
        "role": "SUPER_ADMIN",
        "created_at": now_iso
    }

def count_super_admins() -> int:
    init_admin_db()
    conn = get_admin_db_connection()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM super_admins WHERE is_active = 1")
    count = c.fetchone()[0]
    conn.close()
    return count

# ==================== COMPANY ACCOUNT & LICENSING ====================

def generate_company_id() -> str:
    """Generates unique formatted Company ID, e.g. CMP-8492-X."""
    return f"CMP-{secrets.randbelow(8999) + 1000}-{secrets.token_hex(1).upper()}"

def generate_license_key(company_id: str) -> str:
    """Generates distinct, readable License Key format: SNX-XXXX-XXXX-XXXX."""
    part1 = secrets.token_hex(2).upper()
    part2 = secrets.token_hex(2).upper()
    part3 = secrets.token_hex(2).upper()
    return f"SNX-{company_id.replace('-', '')[:4]}-{part1}-{part2}"

def create_company_account(
    name: str,
    contact_email: str,
    contact_phone: str = "",
    address: str = "",
    plan_type: str = "Enterprise",
    max_users: int = 5,
    validity_days: int = 365,
    actor_admin_id: str = "SYSTEM"
) -> Dict[str, Any]:
    init_admin_db()
    conn = get_admin_db_connection()
    c = conn.cursor()

    # Generate unique ID and license key
    company_id = generate_company_id()
    while True:
        c.execute("SELECT id FROM companies WHERE company_id = ?", (company_id,))
        if not c.fetchone():
            break
        company_id = generate_company_id()

    license_key = generate_license_key(company_id)
    now = datetime.now(timezone.utc)
    start_iso = now.isoformat()
    expiry = now + timedelta(days=validity_days)
    expiry_iso = expiry.isoformat()

    c.execute("""
        INSERT INTO companies (
            company_id, name, contact_email, contact_phone, address,
            plan_type, max_users, license_status, license_key,
            license_start, license_expiry, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
    """, (
        company_id, name.strip(), contact_email.strip().lower(), contact_phone.strip(), address.strip(),
        plan_type, max_users, license_key, start_iso, expiry_iso, start_iso, start_iso
    ))
    conn.commit()
    conn.close()

    log_admin_action(
        action="COMPANY_CREATED",
        actor_admin_id=actor_admin_id,
        target_type="COMPANY",
        target_id=company_id,
        details=f"Created company {name} ({company_id}) with {plan_type} license ({validity_days} days)"
    )

    return get_company_by_id(company_id)

def get_company_by_id(company_id: str) -> Optional[Dict[str, Any]]:
    conn = get_admin_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM companies WHERE company_id = ?", (company_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    # Check if expired dynamically
    res = check_and_update_expiry(res)
    return res

def get_company_by_license_key(license_key: str) -> Optional[Dict[str, Any]]:
    conn = get_admin_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM companies WHERE license_key = ?", (license_key.strip(),))
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    return check_and_update_expiry(res)

def check_and_update_expiry(company_data: Dict[str, Any]) -> Dict[str, Any]:
    """Helper to verify dynamic expiry and update status if needed."""
    try:
        expiry_dt = datetime.fromisoformat(company_data["license_expiry"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if now > expiry_dt and company_data["license_status"] == "ACTIVE":
            company_data["license_status"] = "EXPIRED"
            conn = get_admin_db_connection()
            c = conn.cursor()
            c.execute(
                "UPDATE companies SET license_status = 'EXPIRED', updated_at = ? WHERE company_id = ?",
                (now.isoformat(), company_data["company_id"])
            )
            conn.commit()
            conn.close()
    except Exception:
        pass
    return company_data

def list_companies(
    status_filter: Optional[str] = None,
    search_query: Optional[str] = None
) -> List[Dict[str, Any]]:
    init_admin_db()
    conn = get_admin_db_connection()
    c = conn.cursor()
    query = "SELECT * FROM companies WHERE 1=1"
    params = []

    if status_filter and status_filter.upper() != "ALL":
        query += " AND license_status = ?"
        params.append(status_filter.upper())
    
    if search_query:
        query += " AND (name LIKE ? OR company_id LIKE ? OR contact_email LIKE ?)"
        q = f"%{search_query.strip()}%"
        params.extend([q, q, q])

    query += " ORDER BY id DESC"
    c.execute(query, tuple(params))
    rows = [check_and_update_expiry(dict(r)) for r in c.fetchall()]
    conn.close()
    return rows

def update_company_status(company_id: str, new_status: str, actor_admin_id: str) -> Dict[str, Any]:
    valid = ["ACTIVE", "SUSPENDED", "EXPIRED", "PENDING"]
    new_status = new_status.upper()
    if new_status not in valid:
        raise ValueError(f"Invalid status: {new_status}")

    conn = get_admin_db_connection()
    c = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    c.execute(
        "UPDATE companies SET license_status = ?, updated_at = ? WHERE company_id = ?",
        (new_status, now_iso, company_id)
    )
    conn.commit()
    conn.close()

    log_admin_action(
        action="LICENSE_STATUS_CHANGE",
        actor_admin_id=actor_admin_id,
        target_type="COMPANY",
        target_id=company_id,
        details=f"Changed status to {new_status}"
    )
    return get_company_by_id(company_id)

def update_company_details(company_id: str, updates: Dict[str, Any], actor_admin_id: str) -> Dict[str, Any]:
    allowed_keys = ["name", "contact_email", "contact_phone", "address", "plan_type", "max_users", "license_expiry"]
    set_clauses = []
    params = []
    for k, v in updates.items():
        if k in allowed_keys:
            set_clauses.append(f"{k} = ?")
            params.append(v)
    
    if not set_clauses:
        return get_company_by_id(company_id)

    set_clauses.append("updated_at = ?")
    params.append(datetime.now(timezone.utc).isoformat())
    params.append(company_id)

    conn = get_admin_db_connection()
    c = conn.cursor()
    c.execute(f"UPDATE companies SET {', '.join(set_clauses)} WHERE company_id = ?", tuple(params))
    conn.commit()
    conn.close()

    log_admin_action(
        action="COMPANY_UPDATED",
        actor_admin_id=actor_admin_id,
        target_type="COMPANY",
        target_id=company_id,
        details=f"Updated fields: {list(updates.keys())}"
    )
    return get_company_by_id(company_id)

def get_admin_dashboard_metrics() -> Dict[str, Any]:
    companies = list_companies()
    total = len(companies)
    active = sum(1 for c in companies if c["license_status"] == "ACTIVE")
    suspended = sum(1 for c in companies if c["license_status"] == "SUSPENDED")
    expired = sum(1 for c in companies if c["license_status"] == "EXPIRED")
    
    # Approaching expiry (within 14 days)
    now = datetime.now(timezone.utc)
    approaching_expiry = 0
    for c in companies:
        if c["license_status"] == "ACTIVE":
            try:
                exp = datetime.fromisoformat(c["license_expiry"].replace("Z", "+00:00"))
                days_left = (exp - now).total_seconds() / 86400.0
                if 0 <= days_left <= 14:
                    approaching_expiry += 1
            except Exception:
                pass

    return {
        "total_companies": total,
        "active_companies": active,
        "suspended_companies": suspended,
        "expired_licenses": expired,
        "approaching_expiry": approaching_expiry,
        "companies": companies[:10] # Recent 10 for dashboard preview
    }

# ==================== AUDIT LOGS ====================

def log_admin_action(
    action: str,
    actor_admin_id: str,
    target_type: str,
    target_id: str,
    details: str = "",
    ip_address: str = "127.0.0.1"
):
    try:
        init_admin_db()
        conn = get_admin_db_connection()
        c = conn.cursor()
        now_iso = datetime.now(timezone.utc).isoformat()
        c.execute("""
            INSERT INTO admin_audit_logs (action, actor_admin_id, target_type, target_id, details, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (action, actor_admin_id, target_type, target_id, details, ip_address, now_iso))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Audit log failed: {e}")

def get_audit_logs(limit: int = 50) -> List[Dict[str, Any]]:
    init_admin_db()
    conn = get_admin_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows
