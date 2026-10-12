import os
import sqlite3
import hashlib
import secrets

def update_database(db_path):
    if not os.path.exists(db_path):
        print(f"Skipping non-existent: {db_path}")
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', b'admin1234', bytes.fromhex(salt), 120_000).hex()
    
    # 1. Update superadmin and fix email
    cur.execute("""
        UPDATE super_admins 
        SET password_hash = ?, salt = ?, email = 'swadhinparida283@gmail.com' 
        WHERE username = 'superadmin'
    """, (key, salt))
    
    # 2. Insert or update sysadmin_api_test
    cur.execute("SELECT id FROM super_admins WHERE username = 'sysadmin_api_test'")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE super_admins SET password_hash = ?, salt = ?, email = 'sysadmin_api@sentinelx.local' WHERE id = ?", (key, salt, row[0]))
    else:
        cur.execute("""
            INSERT INTO super_admins (admin_id, username, email, password_hash, salt, role, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, ('SA-SYSADMIN', 'sysadmin_api_test', 'sysadmin_api@sentinelx.local', key, salt, 'SUPER_ADMIN', 1))
    
    # 3. Insert or update 'admin' account
    cur.execute("SELECT id FROM super_admins WHERE username = 'admin'")
    row_admin = cur.fetchone()
    if row_admin:
        cur.execute("UPDATE super_admins SET password_hash = ?, salt = ?, email = 'admin@sentinelx.local' WHERE id = ?", (key, salt, row_admin[0]))
    else:
        cur.execute("""
            INSERT INTO super_admins (admin_id, username, email, password_hash, salt, role, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, ('SA-ADMIN', 'admin', 'admin@sentinelx.local', key, salt, 'SUPER_ADMIN', 1))

    conn.commit()
    
    # Verify records
    cur.execute("SELECT admin_id, username, email FROM super_admins")
    records = cur.fetchall()
    conn.close()
    print(f"Successfully updated {db_path}:")
    for r in records:
        print("  -", r)

if __name__ == '__main__':
    appdata_db = os.path.join(os.environ.get('APPDATA', ''), 'SentinelX AI', 'sentinelx_admin.db')
    update_database(appdata_db)
    workspace_db = os.path.join(os.path.dirname(__file__), '..', 'sentinelx_admin.db')
    update_database(os.path.abspath(workspace_db))
