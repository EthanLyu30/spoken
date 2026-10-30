"""Resolve or grant an EXISTING account in the server's configured database.

Run from backend: python scripts/admin_user.py --email OWNER_EMAIL [--grant]
No password, API key or account email is printed. No public grant endpoint exists.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email', required=True)
    parser.add_argument('--grant', action='store_true', help='Explicitly grant the existing account administrator access')
    args = parser.parse_args()
    from sqlalchemy import select
    from sqlalchemy.exc import SQLAlchemyError
    from app.db import SessionLocal
    from app.models.user import User
    from app.services.telemetry import grant_admin, is_admin
    try:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
            if user is None:
                parser.error('Existing account not found; no account was created')
            if args.grant:
                grant_admin(db, args.email)
            print(json.dumps({'user_id': user.id, 'is_admin': is_admin(db, user.id)}))
    except SQLAlchemyError:
        parser.exit(2, 'Admin database lookup failed. Verify the server DATABASE_URL and deployed schema.\n')


if __name__ == '__main__':
    main()
