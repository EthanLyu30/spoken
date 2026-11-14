"""Password hashing (stdlib PBKDF2) and JWT helpers.

Hashing uses ``hashlib.pbkdf2_hmac`` so there is no native build dependency
(passlib/bcrypt are notoriously fiddly on slim hosts). Tokens are stateless
HS256 JWTs signed with ``JWT_SECRET``.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import get_settings

_ALGO = "HS256"
_PBKDF2_ROUNDS = 200_000
_GUEST_CLAIM_AUDIENCE = "spoken-guest-claim"
_GUEST_CLAIM_TTL_SECONDS = 120
# Development remains zero-config without giving every installation the same
# signing key. Configure JWT_SECRET for sessions that survive process restarts
# and for deployments with more than one worker.
_DEV_SECRET = secrets.token_urlsafe(48)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds_s)
        )
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


def _secret() -> str:
    return get_settings().jwt_secret or _DEV_SECRET


def create_token(user_id: int, auth_version: str = "") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": auth_version,
        "iat": now,
        "exp": now + timedelta(days=get_settings().jwt_expire_days),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGO)


def decode_token(token: str) -> int | None:
    """Return the user id from a valid token, or None if missing/expired/forged."""
    claims = decode_account_token(token)
    return claims[0] if claims else None


def decode_account_token(token: str) -> tuple[int, str] | None:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_ALGO])
        version = payload.get("ver", "")
        return (int(payload["sub"]), version) if isinstance(version, str) else None
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


def feedback_key(purpose: str, value: str) -> str:
    return hmac.new(_secret().encode(), f"spoken-feedback/{purpose}/{value}".encode(), hashlib.sha256).hexdigest()


def create_guest_claim_ticket(guest_id: str, transition_id: str) -> str:
    """Authorize one guest registration while the claim protocol is enabled."""
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "aud": _GUEST_CLAIM_AUDIENCE,
        "guest_id": guest_id,
        "transition_id": transition_id,
        "iat": now,
        "exp": now + timedelta(seconds=_GUEST_CLAIM_TTL_SECONDS),
    }, _secret(), algorithm=_ALGO)


def verify_guest_claim_ticket(ticket: str, guest_id: str, transition_id: str) -> bool:
    try:
        payload = jwt.decode(ticket, _secret(), algorithms=[_ALGO],
                             audience=_GUEST_CLAIM_AUDIENCE, options={"require": ["iat", "exp"]})
        return payload.get("guest_id") == guest_id and payload.get("transition_id") == transition_id
    except jwt.PyJWTError:
        return False
