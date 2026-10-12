import sys
import os
import unittest
import json
from datetime import datetime, timezone, timedelta

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.database.admin_db import (
    init_admin_db,
    hash_password,
    verify_password,
    create_signed_token,
    verify_signed_token,
    create_super_admin,
    get_super_admin_by_email_or_username,
    create_company_account,
    get_company_by_id,
    list_companies,
    update_company_status,
    update_company_details,
    get_admin_dashboard_metrics,
    get_audit_logs,
    count_super_admins
)
from backend.services.license_service import (
    activate_company_license,
    get_current_license_status,
    issue_company_license_token
)

class TestSuperAdminBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_admin_db()

    def test_01_password_hashing(self):
        pw = "SuperSecurePass!123"
        h1, s1 = hash_password(pw)
        h2, s2 = hash_password(pw)
        # Salt must be unique
        self.assertNotEqual(s1, s2)
        self.assertNotEqual(h1, h2)
        # Verification must succeed
        self.assertTrue(verify_password(pw, h1, s1))
        self.assertTrue(verify_password(pw, h2, s2))
        # Invalid password must fail
        self.assertFalse(verify_password("WrongPassword", h1, s1))

    def test_02_signed_tokens(self):
        payload = {"sub": "ADM-TEST", "role": "SUPER_ADMIN"}
        token = create_signed_token(payload, expires_in_seconds=3600)
        self.assertIn(".", token)
        
        verified = verify_signed_token(token)
        self.assertIsNotNone(verified)
        self.assertEqual(verified["sub"], "ADM-TEST")
        self.assertEqual(verified["role"], "SUPER_ADMIN")

        # Tampered token must fail
        tampered = token[:-4] + "AAAA"
        self.assertIsNone(verify_signed_token(tampered))

        # Expired token must fail
        expired_token = create_signed_token(payload, expires_in_seconds=-10)
        self.assertIsNone(verify_signed_token(expired_token))

    def test_03_create_and_find_super_admin(self):
        unique_name = f"admin_test_{datetime.now().microsecond}"
        unique_email = f"{unique_name}@sentinelx.local"
        admin = create_super_admin(unique_name, unique_email, "AdminPass#9988")
        self.assertTrue(admin["admin_id"].startswith("ADM-"))
        
        found = get_super_admin_by_email_or_username(unique_email)
        self.assertIsNotNone(found)
        self.assertEqual(found["admin_id"], admin["admin_id"])

    def test_04_create_company_and_licensing(self):
        c = create_company_account(
            name="Apex Heavy Industries",
            contact_email="safety@apexindustries.test",
            contact_phone="+1-800-555-0144",
            address="Plant 4, Industrial Sector",
            plan_type="Enterprise",
            max_users=10,
            validity_days=180,
            actor_admin_id="ADM-TEST"
        )
        self.assertTrue(c["company_id"].startswith("CMP-"))
        self.assertTrue(c["license_key"].startswith("SNX-"))
        self.assertEqual(c["license_status"], "ACTIVE")

        # Retrieve company
        fetched = get_company_by_id(c["company_id"])
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["name"], "Apex Heavy Industries")

    def test_05_company_status_changes(self):
        c = create_company_account(
            name="Titan Logistics",
            contact_email="ops@titanlogistics.test",
            plan_type="Professional",
            validity_days=30
        )
        cid = c["company_id"]
        # Suspend
        updated = update_company_status(cid, "SUSPENDED", actor_admin_id="ADM-TEST")
        self.assertEqual(updated["license_status"], "SUSPENDED")

        # Reactivate
        reactivated = update_company_status(cid, "ACTIVE", actor_admin_id="ADM-TEST")
        self.assertEqual(reactivated["license_status"], "ACTIVE")

    def test_06_dashboard_metrics(self):
        metrics = get_admin_dashboard_metrics()
        self.assertGreaterEqual(metrics["total_companies"], 1)
        self.assertIn("active_companies", metrics)
        self.assertIn("suspended_companies", metrics)
        self.assertIn("expired_licenses", metrics)
        self.assertIn("approaching_expiry", metrics)

    def test_07_audit_logging(self):
        logs = get_audit_logs(limit=10)
        self.assertGreaterEqual(len(logs), 1)
        self.assertIn("action", logs[0])
        self.assertIn("actor_admin_id", logs[0])
        self.assertIn("created_at", logs[0])

    def test_08_company_license_activation_flow(self):
        c = create_company_account(
            name="Orion Manufacturing",
            contact_email="admin@orionmfg.test",
            plan_type="Enterprise",
            validity_days=365
        )
        # Invalid key should fail
        res_fail = activate_company_license(c["company_id"], "INVALID-KEY-123")
        self.assertFalse(res_fail["success"])

        # Correct key should succeed
        res_ok = activate_company_license(c["company_id"], c["license_key"])
        self.assertTrue(res_ok["success"])

        # Status check should report active
        status = get_current_license_status()
        self.assertTrue(status["is_licensed"])
        self.assertIn(status["status"], ["ACTIVE", "OFFLINE_ACTIVE"])

    def test_09_database_isolation(self):
        # Verify that admin database has zero worker tables
        from backend.database.admin_db import get_admin_db_connection
        conn = get_admin_db_connection()
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in c.fetchall()]
        conn.close()

        self.assertIn("super_admins", tables)
        self.assertIn("companies", tables)
        self.assertIn("admin_audit_logs", tables)
        self.assertNotIn("workers", tables) # Zero worker data in admin DB!
        self.assertNotIn("incidents", tables)
        self.assertNotIn("ppe_detections", tables)

if __name__ == "__main__":
    unittest.main()
