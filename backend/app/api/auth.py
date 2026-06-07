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
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, UserOut
from app.services import users as repo

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    device_id: str = Depends(get_client_id),
) -> AuthResponse:
    if repo.get_by_email(db, payload.email) is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册，去登录吧")
    user = repo.create_user(db, payload.email, hash_password(payload.password))
    # Bind the progress collected anonymously on this device to the new account.
    repo.claim_device_data(db, device_id, f"u:{user.id}")
    return AuthResponse(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = repo.get_by_email(db, payload.email)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    return AuthResponse(token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
