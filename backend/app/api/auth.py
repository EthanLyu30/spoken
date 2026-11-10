"""Account endpoints: register / login / current user.

Accounts are optional and additive. When a request carries a valid Bearer
token, :func:`app.core.deps.get_client_id` resolves the owner to ``u:<id>`` so
the existing word/session/practice endpoints become account-scoped with no
other changes.
"""

import os

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.deps import get_optional_client_id, get_current_user
from app.core.security import (
    create_guest_claim_ticket, create_token, hash_password, verify_guest_claim_ticket, verify_password,
)
from app.db import get_db
from app.models.progress import GuestClaim
from app.models.user import User
from app.schemas.auth import AuthResponse, LoginRequest, ProfileUpdate, RegisterRequest, UserOut
from app.services import users as repo
from app.services.telemetry import is_admin

router = APIRouter(prefix="/auth", tags=["auth"])


def guest_claim_protocol() -> int:
    """0 = legacy, 1 = shadow claim protocol."""
    return int(os.environ.get("GUEST_CLAIM_PROTOCOL") == "1")


@router.get("/guest-capabilities")
def guest_capabilities(
    response: Response,
    device_id: str = Depends(get_optional_client_id),
    x_claim_transition: str | None = Header(default=None, alias="X-Claim-Transition", max_length=64),
) -> dict[str, int | str]:
    response.headers["Cache-Control"] = "no-store"
    protocol = guest_claim_protocol()
    capability: dict[str, int | str] = {"protocol": protocol}
    if protocol == 1 and x_claim_transition and device_id and not device_id.startswith("u:"):
        capability["ticket"] = create_guest_claim_ticket(device_id, x_claim_transition)
    return capability


def _user_out(user: User, db: Session) -> UserOut:
    return UserOut.model_validate(user).model_copy(update={
        "is_admin": is_admin(db, user.id), "email_verified": user.email_verified_at is not None,
    })


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_optional_client_id),
    x_claim_protocol: int | None = Header(default=None, alias="X-Claim-Protocol"),
    x_claim_transition: str | None = Header(default=None, alias="X-Claim-Transition", max_length=64),
    x_claim_ticket: str | None = Header(default=None, alias="X-Claim-Ticket", max_length=1024),
) -> AuthResponse:
    if repo.get_by_email(db, payload.email) is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册，去登录吧")
    # A friendly starting name from the email's local part; user can rename later.
    default_name = payload.email.split("@", 1)[0][:40]
    protocol = guest_claim_protocol()
    use_shadow = x_claim_protocol == 1
    if x_claim_transition is not None or x_claim_ticket is not None or (use_shadow and protocol == 0):
        if not (use_shadow and x_claim_transition and x_claim_ticket
                and verify_guest_claim_ticket(x_claim_ticket, device_id, x_claim_transition)):
            raise HTTPException(status_code=409, detail="进度认领授权已失效，请重新注册")
        # Mode 0 stops issuing tickets, while an admitted registration can
        # still commit its recovery marker if the response never reaches the browser.
    user = repo.create_user(
        db, payload.email, hash_password(payload.password), display_name=default_name,
        commit=False,
    )
    try:
        migrated = repo.claim_device_data(db, device_id, f"u:{user.id}", mark_claim=use_shadow)
    except repo.GuestAlreadyClaimed:
        db.rollback()
        raise HTTPException(status_code=409, detail="guest_data_claimed")
    db.commit()
    db.refresh(user)
    return AuthResponse(
        token=create_token(user.id, user.auth_version), user=_user_out(user, db),
        claim={"protocol": protocol, "claimed": use_shadow and migrated, "migrated": migrated},
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = repo.get_by_email(db, payload.email)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    return AuthResponse(token=create_token(user.id, user.auth_version), user=_user_out(user, db))


@router.get("/guest-claim")
def guest_claim_status(
    guest_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Let the current account check whether a queued guest record is its own.

    Never exposes the owning account id; a different login sees ``mine=false``
    and must keep the record queued rather than writing it under its account.
    """
    claim = db.get(GuestClaim, guest_id.strip())
    owner = f"u:{user.id}"
    return {"claimed": claim is not None, "mine": claim is not None and claim.owner_id == owner}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    return _user_out(user, db)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserOut:
    """Edit the display name and/or avatar of the logged-in account."""
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    db.commit()
    db.refresh(user)
    return _user_out(user, db)
