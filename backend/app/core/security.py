"""Password hashing (stdlib PBKDF2) and JWT helpers.

Hashing uses ``hashlib.pbkdf2_hmac`` so there is no native build dependency
(passlib/bcrypt are notoriously fiddly on slim hosts). Tokens are stateless
HS256 JWTs signed with ``JWT_SECRET``.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import get_settings

_ALGO = "HS256"
_PBKDF2_ROUNDS = 200_000
_DEV_SECRET = "dev-insecure-secret-change-me-in-production"  # local fallback only (>=32 bytes)


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


def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=get_settings().jwt_expire_days),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGO)


def decode_token(token: str) -> int | None:
    """Return the user id from a valid token, or None if missing/expired/forged."""
    try:
        payload = jwt.decode(token, _secret(), algorithms=[_ALGO])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
