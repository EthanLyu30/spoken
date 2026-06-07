"""Shared FastAPI dependencies."""

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db import get_db
from app.models.user import User


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def get_client_id(
    x_client_id: str | None = Header(default=None, alias="X-Client-Id"),
    authorization: str | None = Header(default=None),
) -> str:
    """Resolve the data owner for the request.

    A valid Bearer token wins, scoping data to the account (``u:<id>``).
    Otherwise fall back to the per-device X-Client-Id header (no login), or a
    shared ``anon`` bucket. Every owner-scoped endpoint depends on this, so
    accounts work everywhere without touching the endpoints themselves.
    """
    token = _bearer(authorization)
    if token:
        uid = decode_token(token)
        if uid is not None:
            return f"u:{uid}"
    cid = (x_client_id or "").strip()
    return cid[:64] if cid else "anon"


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
