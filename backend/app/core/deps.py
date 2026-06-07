"""Shared FastAPI dependencies."""

from fastapi import Header


def get_client_id(x_client_id: str | None = Header(default=None, alias="X-Client-Id")) -> str:
    """Per-device identity (no login). The frontend sends a stable random id in
    the X-Client-Id header so each browser sees only its own data. Requests
    without the header fall back to a shared "anon" bucket."""
    cid = (x_client_id or "").strip()
    return cid[:64] if cid else "anon"
