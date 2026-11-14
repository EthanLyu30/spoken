"""Account-owned data and one-time email actions."""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import authenticated_user, get_current_user
from app.core.security import hash_password, verify_password
from app.db import get_db
from app.models.monitoring import SiteVisit
from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, GuestClaim, LearningEvent, ProgressOwner
from app.models.request_receipt import RequestReceipt
from app.models.session import PracticeSession, SkillScore, Turn
from app.models.telemetry import AdminAccount, AdminBootstrap
from app.models.user import AccountAction, User
from app.models.word import WordEntry
from app.schemas.auth import _EMAIL_RE, _normalize_email
from app.services.account_export import build_account_export
from app.services.account_mail import email_actions_enabled, send_account_mail
from app.services.monitoring import visit_digest
from app.services.product_feedback import erase_account_feedback
from app.services.progress import lock_owner
from app.services.users import get_by_email

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class EmailRequest(BaseModel):
    email: str = Field(max_length=255)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = _normalize_email(value)
        if not _EMAIL_RE.fullmatch(value):
            raise ValueError("邮箱格式不正确")
        return value


class PasswordConfirmation(BaseModel):
    password: str = Field(min_length=1, max_length=4096)


class ConfirmEmailAction(BaseModel):
    token: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")


class ConfirmReset(ConfirmEmailAction):
    password: str = Field(min_length=8, max_length=128)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _lock_account(db: Session, user_id: int) -> User | None:
    # A no-op UPDATE takes a writer lock on both SQLite and Postgres.
    db.execute(update(User).where(User.id == user_id).values(auth_version=User.auth_version))
    return db.get(User, user_id, populate_existing=True)


def _deliver(email: str, kind: str, token: str) -> None:
    try:
        send_account_mail(email, kind, token)
    except Exception as exc:
        logger.warning("Account mail failed (%s)", type(exc).__name__)


def _issue(db: Session, user: User, kind: str, tasks: BackgroundTasks) -> None:
    version = user.auth_version
    current = _lock_account(db, user.id)
    if current is None or current.auth_version != version or (kind == "verify" and current.email_verified_at is not None):
        return
    now = _now()
    action = db.get(AccountAction, (current.id, kind))
    if action and now < action.issued_at + timedelta(seconds=90):
        return
    token = secrets.token_urlsafe(32)
    if action is None:
        action = AccountAction(user_id=current.id, kind=kind)
        db.add(action)
    action.digest = hashlib.sha256(token.encode()).hexdigest()
    action.issued_at = now
    action.expires_at = now + timedelta(minutes=30)
    action.consumed_at = None
    db.commit()
    tasks.add_task(_deliver, current.email, kind, token)


def _consume(db: Session, kind: str, token: str, *, password: str | None = None) -> None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    user_id = db.scalar(select(AccountAction.user_id).where(AccountAction.digest == digest, AccountAction.kind == kind))
    invalid = HTTPException(status_code=400, detail="链接已失效，请重新申请")
    if user_id is None:
        raise invalid
    lock_owner(db, f"u:{user_id}")
    user = _lock_account(db, user_id)
    action = db.get(AccountAction, (user_id, kind), populate_existing=True)
    now = _now()
    if user is None or action is None or action.digest != digest or action.consumed_at is not None or action.expires_at <= now:
        raise invalid
    if password is None:
        user.email_verified_at = now
    else:
        user.password_hash = hash_password(password)
        user.auth_version = secrets.token_hex(16)
    action.consumed_at = now
    db.commit()


@router.get("/account-capabilities")
def capabilities(response: Response) -> dict[str, bool]:
    response.headers["Cache-Control"] = "no-store"
    return {"email_actions": email_actions_enabled(), "account_data": True}


@router.get("/me/export")
def export_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    return JSONResponse(jsonable_encoder(build_account_export(db, user)), headers={
        "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="spoken-account.json"',
    })


@router.delete("/me", status_code=204)
def delete_account(payload: PasswordConfirmation, request: Request, db: Session = Depends(get_db)) -> None:
    user = authenticated_user(db, request.headers.get("authorization"), lock_progress=True)
    if _lock_account(db, user.id) is None:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=403, detail="密码不正确")
    owner = f"u:{user.id}"
    owned_sessions = select(PracticeSession.id).where(PracticeSession.client_id == owner)
    for model in (Turn, SkillScore):
        db.execute(delete(model).where(model.session_id.in_(owned_sessions)))
    for model in (PracticeSession, PracticeRecord, WordEntry, LearningEvent, EarnedBadge, RequestReceipt, ProgressOwner):
        db.execute(delete(model).where(model.client_id == owner))
    db.execute(delete(GuestClaim).where(GuestClaim.owner_id == owner))
    db.execute(delete(AccountAction).where(AccountAction.user_id == user.id))
    db.execute(delete(AdminAccount).where(AdminAccount.user_id == user.id))
    db.execute(update(AdminBootstrap).where(AdminBootstrap.user_id == user.id).values(user_id=None))
    secret = get_settings().jwt_secret
    if secret:
        db.execute(delete(SiteVisit).where(SiteVisit.kind == "registered",
                                          SiteVisit.subject_hash == visit_digest(secret, "registered", owner)))
    erase_account_feedback(db, user.id)
    db.delete(user)
    db.commit()


@router.post("/password-reset", status_code=202)
def request_password_reset(payload: EmailRequest, tasks: BackgroundTasks, db: Session = Depends(get_db)) -> None:
    if not email_actions_enabled():
        raise HTTPException(status_code=503, detail="邮件服务暂不可用")
    user = get_by_email(db, payload.email)
    if user is not None:
        _issue(db, user, "reset", tasks)


@router.post("/password-reset/confirm", status_code=204)
def reset_password(payload: ConfirmReset, db: Session = Depends(get_db)) -> None:
    _consume(db, "reset", payload.token, password=payload.password)


@router.post("/email-verification", status_code=202)
def request_email_verification(tasks: BackgroundTasks, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    if not email_actions_enabled():
        raise HTTPException(status_code=503, detail="邮件服务暂不可用")
    _issue(db, user, "verify", tasks)


@router.post("/email-verification/confirm", status_code=204)
def verify_email(payload: ConfirmEmailAction, db: Session = Depends(get_db)) -> None:
    _consume(db, "verify", payload.token)
