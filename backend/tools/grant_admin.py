"""Give, take away or list the Firebase `admin` custom claim (the role behind /admin/* routes).

    python backend/tools/grant_admin.py --list                      # uids that hold the claim
    python backend/tools/grant_admin.py --list --show-emails        # ... with their addresses
    python backend/tools/grant_admin.py --email me@example.com      # grant
    python backend/tools/grant_admin.py --email me@example.com --revoke

    python backend/tools/grant_admin.py --gcloud-token --project <id> --list   # no ADC on this machine

Credentials: Application Default Credentials (`gcloud auth application-default login`) or
GOOGLE_APPLICATION_CREDENTIALS; without ADC, --gcloud-token --project <id> signs the calls with
`gcloud auth print-access-token` (as tools/load_phish_list.py does).
The project also serves as the quota project (x-goog-user-project), which Identity Toolkit requires for a user token. The project otherwise comes from
GOOGLE_CLOUD_PROJECT (repo-root .env). An anonymous user (a protected person's device) is refused. The user has to sign in again, or wait for
the ID token to refresh (up to an hour), before the claim shows.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "core"))


def _is_anonymous(user) -> bool:
    return not user.provider_data and not user.email


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", help="Firebase user to change")
    ap.add_argument("--revoke", action="store_true", help="remove the claim instead of setting it")
    ap.add_argument("--list", action="store_true", help="print the uids that hold the claim")
    ap.add_argument("--show-emails", action="store_true", help="with --list: print addresses too")
    ap.add_argument("--gcloud-token", action="store_true", help="no ADC on this machine: use `gcloud auth print-access-token`")
    ap.add_argument("--project", help="Firebase project id (required with --gcloud-token)")
    a = ap.parse_args()
    if not a.list and not a.email:
        ap.error("give --email or --list")
    if a.gcloud_token and not a.project:
        ap.error("--gcloud-token needs --project")

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    from firebase_admin import auth
    if a.gcloud_token:  # this laptop has no ADC: wrap the gcloud user token as a google-auth credential
        import subprocess
        import firebase_admin
        from google.oauth2.credentials import Credentials
        token = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True,
                               shell=True, check=True).stdout.strip()
        app = firebase_admin.initialize_app(credential=Credentials(token, quota_project_id=a.project), options={"projectId": a.project},
                                            name="grant-admin")
    else:
        from app import appcheck
        app = appcheck._app()

    if a.list:
        n = 0
        for user in auth.list_users(app=app).iterate_all():
            if (user.custom_claims or {}).get("admin") is True:
                n += 1
                print(user.uid + (f"  {user.email or '-'}" if a.show_emails else ""))
        print(f"{n} admin(s)")
        return 0

    user = auth.get_user_by_email(a.email, app=app)
    if _is_anonymous(user):
        print("refused: that is an anonymous user, not an account", file=sys.stderr)
        return 2
    claims = dict(user.custom_claims or {})
    if a.revoke:
        claims.pop("admin", None)
    else:
        claims["admin"] = True
    auth.set_custom_user_claims(user.uid, claims or None, app=app)
    print(f"{'revoked admin from' if a.revoke else 'granted admin to'} {user.uid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
