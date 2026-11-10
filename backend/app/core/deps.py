"""Shared FastAPI dependencies."""

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.security import decode_token
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


def get_optional_client_id(
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
) -> str:
    """Resolve the data owner for the request.

    A valid Bearer token wins, scoping data to the account (``u:<id>``).
    Guest IDs retain their existing values, but cannot name the reserved
    account namespace. Invalid credentials never downgrade to guest access.
    """
    token = _bearer(authorization)
    if authorization is not None:
        uid = decode_token(token) if token else None
        if uid is None:
            raise HTTPException(status_code=401, detail="未登录或登录已过期")
        return f"u:{uid}"
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

    Once a guest owner has been claimed, a write that still names it is only
    allowed for the owning account. The old guest (or a different login) gets a
    recoverable 409 instead of recreating data under the wrong owner.
    """
    owner = get_optional_client_id(x_client_id, authorization)
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
            claim = db.get(GuestClaim, guest)
            if claim is not None and owner != claim.owner_id:
                raise HTTPException(status_code=409, detail="guest_data_claimed")
    if not owner:
        raise HTTPException(status_code=400, detail="A device identifier or login is required")
    return owner


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Require a logged-in account; 401 otherwise."""
    token = _bearer(authorization)
    uid = decode_token(token) if token else None
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return user
