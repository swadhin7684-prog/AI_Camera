import sys
import os
import unittest
from fastapi.testclient import TestClient

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.main import app
from backend.database.admin_db import (
    init_admin_db,
    create_super_admin,
    get_super_admin_by_email_or_username,
    create_company_account
)

client = TestClient(app)

class TestAdminApiEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_admin_db()
        # Seed test admin if needed
        cls.username = "sysadmin_api_test"
        cls.email = "sysadmin_api@sentinelx.local"
        cls.password = "SecureAdmin#2026!"
        existing = get_super_admin_by_email_or_username(cls.email)
        if not existing:
            cls.admin = create_super_admin(cls.username, cls.email, cls.password)
        else:
            cls.admin = existing

    def test_01_unauthorized_access_blocked(self):
        # Accessing dashboard without token must yield 401
        res = client.get("/api/admin/dashboard")
        self.assertEqual(res.status_code, 401)

        # Accessing company list without token must yield 401
        res2 = client.get("/api/admin/companies")
        self.assertEqual(res2.status_code, 401)

    def test_02_invalid_credentials_rejected(self):
        res = client.post("/api/admin/auth/login", json={
            "username_or_email": self.username,
            "password": "WrongPassword#000"
        })
        self.assertEqual(res.status_code, 401)

    def test_03_valid_login_and_token(self):
        res = client.post("/api/admin/auth/login", json={
            "username_or_email": self.username,
            "password": self.password
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertIn("token", data)
        self.token = data["token"]

        # Authorized request to dashboard
        headers = {"Authorization": f"Bearer {self.token}"}
        dash_res = client.get("/api/admin/dashboard", headers=headers)
        self.assertEqual(dash_res.status_code, 200)
        dash_data = dash_res.json()
        self.assertIn("total_companies", dash_data)
        self.assertIn("active_companies", dash_data)

    def test_04_create_and_manage_company_api(self):
        # Login to get token
        login = client.post("/api/admin/auth/login", json={
            "username_or_email": self.username,
            "password": self.password
        }).json()
        headers = {"Authorization": f"Bearer {login['token']}"}

        # Create company
        new_co = client.post("/api/admin/companies", headers=headers, json={
            "name": "Global Steel Fabrications",
            "contact_email": "ops@globalsteel.test",
            "contact_phone": "+1-555-0188",
            "plan_type": "Enterprise",
            "max_users": 8,
            "validity_days": 180
        })
        self.assertEqual(new_co.status_code, 200)
        co_data = new_co.json()["company"]
        cid = co_data["company_id"]
        self.assertTrue(cid.startswith("CMP-"))

        # Suspend company
        suspend_res = client.patch(f"/api/admin/companies/{cid}/status", headers=headers, json={
            "status": "SUSPENDED"
        })
        self.assertEqual(suspend_res.status_code, 200)
        self.assertEqual(suspend_res.json()["company"]["license_status"], "SUSPENDED")

        # Reactivate company
        reactivate_res = client.patch(f"/api/admin/companies/{cid}/status", headers=headers, json={
            "status": "ACTIVE"
        })
        self.assertEqual(reactivate_res.status_code, 200)
        self.assertEqual(reactivate_res.json()["company"]["license_status"], "ACTIVE")

    def test_05_client_license_endpoints(self):
        # Test current license status endpoint (publicly available to local frontend)
        status_res = client.get("/api/license/status")
        self.assertEqual(status_res.status_code, 200)
        data = status_res.json()
        self.assertIn("is_licensed", data)
        self.assertIn("status", data)

if __name__ == "__main__":
    unittest.main()
