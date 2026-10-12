import sys
import os
import argparse
import getpass

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.database.admin_db import (
    init_admin_db,
    create_super_admin,
    count_super_admins,
    get_super_admin_by_email_or_username
)

def main():
    parser = argparse.ArgumentParser(description="SentinelX AI — Super Admin Account Provisioning Tool")
    parser.add_argument("--username", help="Administrator username", default=None)
    parser.add_argument("--email", help="Administrator email", default=None)
    parser.add_argument("--password", help="Administrator password", default=None)
    args = parser.parse_args()

    init_admin_db()

    print("==================================================================")
    print("   SENTINELX AI — SUPER ADMIN PROVISIONING UTILITY")
    print("==================================================================")

    username = args.username
    if not username:
        username = input("Enter Super Admin Username: ").strip()

    email = args.email
    if not email:
        email = input("Enter Super Admin Email: ").strip()

    existing = get_super_admin_by_email_or_username(email) or get_super_admin_by_email_or_username(username)
    if existing:
        print(f"[!] An administrator account with that username or email already exists (ID: {existing['admin_id']}).")
        sys.exit(1)

    password = args.password
    if not password:
        password = getpass.getpass("Enter Super Admin Password (min 8 chars): ").strip()
        confirm = getpass.getpass("Confirm Super Admin Password: ").strip()
        if password != confirm:
            print("[X] Error: Passwords do not match.")
            sys.exit(1)

    if len(password) < 8:
        print("[X] Error: Password must be at least 8 characters long.")
        sys.exit(1)

    admin = create_super_admin(username, email, password)
    print("\n[+] SUCCESS: Super Admin account provisioned successfully!")
    print(f"    Admin ID:   {admin['admin_id']}")
    print(f"    Username:   {admin['username']}")
    print(f"    Email:      {admin['email']}")
    print(f"    Role:       {admin['role']}")
    print(f"    Created At: {admin['created_at']}")
    print("==================================================================")

if __name__ == "__main__":
    main()
