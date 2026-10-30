"""Account endpoints: register / login / current user.

Accounts are optional and additive. When a request carries a valid Bearer
token, :func:`app.core.deps.get_client_id` resolves the owner to ``u:<id>`` so
the existing word/session/practice endpoints become account-scoped with no
other changes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_client_id, get_current_user
from app.core.security import create_token, hash_password, verify_password
from app.db import get_db
from app.models.user import User
from app.schemas.auth import AuthResponse, LoginRequest, ProfileUpdate, RegisterRequest, UserOut
from app.services import users as repo
from app.services.telemetry import is_admin

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_out(user: User, db: Session) -> UserOut:
    return UserOut.model_validate(user).model_copy(update={"is_admin": is_admin(db, user.id)})


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_client_id),
) -> AuthResponse:
    if repo.get_by_email(db, payload.email) is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册，去登录吧")
    # A friendly starting name from the email's local part; user can rename later.
    default_name = payload.email.split("@", 1)[0][:40]
    user = repo.create_user(
        db, payload.email, hash_password(payload.password), display_name=default_name
    )
    # Bind the progress collected anonymously on this device to the new account.
    repo.claim_device_data(db, device_id, f"u:{user.id}")
    return AuthResponse(token=create_token(user.id), user=_user_out(user, db))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = repo.get_by_email(db, payload.email)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    return AuthResponse(token=create_token(user.id), user=_user_out(user, db))


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
