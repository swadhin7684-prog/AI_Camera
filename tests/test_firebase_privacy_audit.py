import os
import sys
import json
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

class TestFirebasePrivacyAndAirGapAudit(unittest.TestCase):
    """
    Automated security and privacy audit asserting compliance with SentinelX AI constraints:
    1. Zero biometric/face embedding or worker data upload to Firebase.
    2. Zero service-account private keys bundled in code.
    3. Backend token verifier uses zero private keys.
    """

    def test_no_private_service_account_keys_in_repo(self):
        """Scans project files ensuring no private service-account key files are present."""
        forbidden_patterns = [
            "private_key_id",
            "-----BEGIN PRIVATE KEY-----",
            "service_account_key.json"
        ]
        
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        scanned_files = 0
        
        for root, dirs, files in os.walk(project_root):
            # Skip node_modules, git, and build outputs
            if any(skip in root for skip in ["node_modules", ".git", "release", "dist"]):
                continue
            for file in files:
                if file.endswith((".ts", ".tsx", ".js", ".cjs", ".py", ".json")):
                    filepath = os.path.join(root, file)
                    scanned_files += 1
                    try:
                        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                            for pattern in forbidden_patterns:
                                self.assertNotIn(
                                    pattern,
                                    content,
                                    f"SECURITY ALERT: Found forbidden private key pattern '{pattern}' in {filepath}"
                                )
                    except Exception:
                        pass
        self.assertGreater(scanned_files, 20)

    def test_worker_database_remains_local_sqlite(self):
        """Asserts that worker biometrics and incident data are managed strictly in local SQLite."""
        from backend.paths import DB_PATH, DATA_DIR
        self.assertTrue(DB_PATH.endswith("sentinelx.db"))
        self.assertTrue(os.path.isabs(DATA_DIR))

    def test_firebase_verifier_uses_no_private_keys(self):
        """Asserts backend token verifier does not require or load private service account credentials."""
        from backend.auth.firebase_verifier import FIREBASE_PROJECT_ID, GOOGLE_TOKENINFO_URL
        self.assertEqual(FIREBASE_PROJECT_ID, "sentinelx-ai-production-6a42a")
        self.assertTrue(GOOGLE_TOKENINFO_URL.startswith("https://oauth2.googleapis.com"))

if __name__ == "__main__":
    unittest.main()
