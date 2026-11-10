"""Shared FastAPI dependencies."""

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import decode_account_token
from app.db import get_db
from app.models.progress import GuestClaim
from app.models.user import User


def get_timezone(x_timezone: str | None = Header(default=None, alias="X-Timezone")) -> str:
    from app.services.progress import timezone_name

    return timezone_name(x_timezone)


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def authenticated_user(db: Session, authorization: str | None, *, lock_progress: bool = False) -> User:
    token = _bearer(authorization)
    claims = decode_account_token(token) if token else None
    if claims:
        user_id, version = claims
        if lock_progress:
            from app.services.progress import lock_owner
            lock_owner(db, f"u:{user_id}")
        user = db.get(User, user_id, populate_existing=True)
        if user is not None and user.auth_version == version:
            return user
    raise HTTPException(status_code=401, detail="未登录或登录已过期")


def get_optional_client_id(
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> str:
    """Resolve the data owner for the request.

    A valid Bearer token wins, scoping data to the account (``u:<id>``).
    Guest IDs retain their existing values, but cannot name the reserved
    account namespace. Invalid credentials never downgrade to guest access.
    """
    if authorization is not None:
        return f"u:{authenticated_user(db, authorization).id}"
    cid = (x_client_id or "").strip()
    if len(cid) > 64 or cid.lower().startswith("u:"):
        raise HTTPException(status_code=400, detail="Invalid device identifier")
    return "" if cid.lower() == "anon" else cid


def get_client_id(
    request: Request,
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> str:
    """Private stored data requires an account or an unambiguous guest owner.

    A protocol-aware guest can recover writes interrupted by a claim. Legacy
    anonymous writes stay isolated in the guest space across mode changes.
    """
    if authorization is not None:
        writes = request.method not in ("GET", "HEAD", "OPTIONS")
        deferred_word = request.method == "POST" and request.url.path == "/api/words"
        user = authenticated_user(db, authorization, lock_progress=writes and not deferred_word)
        return f"u:{user.id}"
    owner = get_optional_client_id(x_client_id, authorization, db)
    guest = (x_client_id or "").strip()
    if (
        guest
        and not guest.lower().startswith("u:")
        and guest.lower() != "anon"
        and request.method not in ("GET", "HEAD", "OPTIONS")
    ):
        # Account writes keep their own account identity even if the browser
        # still carries a guest id that was claimed by another account. Only a
        # guest write (no Bearer owner) can recreate claimed data under the old
        # guest owner. Word creation performs its definition call before taking
        # the write lock, so defer its claim check to create_word.
        if not owner.startswith("u:"):
            if not (request.method == "POST" and request.url.path == "/api/words"):
                # Serialize this check with claim_device_data, which takes the
                # same ProgressOwner lock before moving rows.
                from app.services import progress
                progress.lock_owner(db, guest)
                if request.headers.get("X-Claim-Protocol") == "1" and db.get(GuestClaim, guest) is not None:
                    raise HTTPException(status_code=409, detail="guest_data_claimed")
    if not owner:
        raise HTTPException(status_code=400, detail="A device identifier or login is required")
    return owner


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Require a logged-in account; 401 otherwise."""
    return authenticated_user(db, authorization)
