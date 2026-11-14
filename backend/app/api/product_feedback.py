"""Public feedback, private receipts, and administrator-only award decisions."""
from datetime import timedelta
import hmac
from ipaddress import ip_address
import os
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.api.admin import get_admin_user
from app.api.chat import get_client
from app.core.deps import authenticated_user, get_current_user
from app.core.ratelimit import limiter
from app.core.security import feedback_key
from app.db import get_db
from app.models.product_feedback import ProductFeedback
from app.models.user import User
from app.schemas.product_feedback import (
    ClaimFeedback, FeedbackEmail, ReconcilePayout, RecordPayout, ReviewFeedback, SubmitFeedback, SupplementFeedback,
    VerifyFeedbackEmail,
)
from app.services import feedback_notifications as mail, product_feedback as service
from app.services.account_mail import email_actions_enabled
from app.services.deepseek import DeepSeekClient
from app.services.progress import utcnow

router = APIRouter(tags=["product-feedback"])
admin = APIRouter(prefix="/admin/product-feedback", tags=["product-feedback-admin"],
                  dependencies=[Depends(get_admin_user)])


def no_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


def _limit(request: Request, kind: str, maximum: int) -> None:
    client = _feedback_client(request)
    if not limiter.allow(f"product-feedback/{kind}/{client}", limit=maximum, window_seconds=3600):
        raise HTTPException(429, "反馈操作过于频繁，请稍后再试。", headers={"Retry-After": "3600"})


def _feedback_client(request: Request) -> str:
    # Render's public edge overwrites CF-Connecting-IP. Do not use caller-supplied
    # forwarding headers on other hosts.
    if os.environ.get("RENDER") == "true" and request.headers.get("CF-Ray"):
        try:
            ip = ip_address(request.headers.get("CF-Connecting-IP", ""))
            if not getattr(ip, "scope_id", None):
                return str(getattr(ip, "ipv4_mapped", None) or ip)
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


def owner_id(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> int | None:
    return authenticated_user(db, authorization).id if authorization is not None else None


def owned_feedback(
    ticket_id: str,
    secret: str | None = Header(None, alias="X-Feedback-Key", min_length=64, max_length=64,
                                pattern=r"^[a-f0-9]{64}$"),
    owner: int | None = Depends(owner_id),
    db: Session = Depends(get_db),
) -> ProductFeedback:
    return service.verify_access(db, ticket_id, secret, owner)


def admin_feedback(ticket_id: str, db: Session = Depends(get_db)) -> ProductFeedback:
    row = db.get(ProductFeedback, ticket_id)
    if row is None:
        raise HTTPException(404, "反馈不存在。")
    return row


@router.get("/product-feedback/pilot", dependencies=[Depends(no_cache)])
def pilot(db: Session = Depends(get_db)):
    return {**service.pilot_status(db, service.configured_pilot()), "email_notifications": email_actions_enabled()}


@router.post("/product-feedback", status_code=201, dependencies=[Depends(no_cache)])
def submit(payload: SubmitFeedback, request: Request, tasks: BackgroundTasks,
           owner: int | None = Depends(owner_id), db: Session = Depends(get_db),
           client: DeepSeekClient = Depends(get_client)):
    _limit(request, "submit", 24)
    if owner is not None:
        authenticated_user(db, request.headers.get("authorization"), lock_progress=True)
    record, created = service.store_feedback(db, payload, owner)
    if record.email and not record.email_verified:
        tasks.add_task(mail.send_verification, record.id)
    tasks.add_task(mail.notify_owner, record.id)
    if created and record.ai_status == "pending":
        tasks.add_task(mail.triage, record.id, client)
    return {**service.serialize(record), "receipt_key": service.receipt_key(record.id)}


@router.get("/product-feedback/mine", dependencies=[Depends(no_cache)])
def mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ProductFeedback).where(ProductFeedback.owner_id == user.id)
                      .order_by(ProductFeedback.created_at.desc()).limit(50))
    return [{"id": row.id, "category": row.category, "created_at": service.iso(row.created_at),
             "status": service.displayed_status(row), "amount": row.amount} for row in rows]


@router.get("/product-feedback/{ticket_id}", dependencies=[Depends(no_cache)])
def receipt(row: ProductFeedback = Depends(owned_feedback), db: Session = Depends(get_db)):
    return service.serialize(service.expire_receipt(db, row))


@router.put("/product-feedback/{ticket_id}/claim", dependencies=[Depends(no_cache)])
def claim(payload: ClaimFeedback, request: Request, row: ProductFeedback = Depends(owned_feedback),
          db: Session = Depends(get_db)):
    _limit(request, "claim", 60)
    row = service.lock_ticket(db, row, reward=True)
    if row.removed_at is not None or row.status not in ("awarded", "ready_to_pay"):
        db.commit()
        raise HTTPException(409, "只有审核通过且仍在领取期的奖励可以领取。")
    if row.status == "ready_to_pay" and row.wechat != payload.wechat:
        raise HTTPException(409, "联系方式已提交。如需更正，请联系 Spoken 负责人。")
    row.wechat = payload.wechat
    row.status = "ready_to_pay"
    db.commit()
    return service.serialize(row)


@router.put("/product-feedback/{ticket_id}/supplement", dependencies=[Depends(no_cache)])
def supplement(payload: SupplementFeedback, row: ProductFeedback = Depends(owned_feedback),
               db: Session = Depends(get_db)):
    row = service.lock_ticket(db, row)
    if row.removed_at is not None:
        raise HTTPException(404, "反馈不存在。")
    if row.status == "pending" and row.supplement == payload.description:
        db.commit()
        return service.serialize(row)
    if row.status != "more_info":
        raise HTTPException(409, "这条反馈目前不需要补充。")
    row.supplement = payload.description
    row.status = "pending"
    db.commit()
    return service.serialize(row)


@router.post("/product-feedback/{ticket_id}/email", status_code=202, dependencies=[Depends(no_cache)])
def request_email(payload: FeedbackEmail, request: Request, tasks: BackgroundTasks,
                  row: ProductFeedback = Depends(owned_feedback), db: Session = Depends(get_db)):
    if not email_actions_enabled():
        raise HTTPException(503, "邮件暂不可用，你仍可在私密回执查看进度。")
    _limit(request, "email", 12)
    row = service.lock_ticket(db, row)
    if row.removed_at is not None:
        raise HTTPException(404, "反馈不存在。")
    now = utcnow()
    if row.email_verified and payload.email and row.email != payload.email:
        raise HTTPException(409, "此回执已确认接收邮箱。")
    if row.email_verified:
        db.commit()
        return service.serialize(row)
    if row.verification_mail_attempt_at and now < row.verification_mail_attempt_at + service.EMAIL_RESEND_AFTER:
        remaining = int((row.verification_mail_attempt_at + service.EMAIL_RESEND_AFTER - now).total_seconds()) + 1
        raise HTTPException(429, "刚发过确认邮件，请稍后再试。", headers={"Retry-After": str(remaining)})
    email = payload.email or row.email
    if not email:
        raise HTTPException(400, "请填写接收邮箱。")
    if (row.email == email and row.verify_sent_at and now < row.verify_sent_at + service.EMAIL_CONFIRM_TTL
            and mail.mail_retry_needs_check(row, "verification", now)):
        raise HTTPException(409, "请先查看收件箱和垃圾邮件。确认链接仍有效，可在过期后重新发送。")
    if (row.email != email or row.verification_mail_status == "sent" or not row.verify_sent_at
        or now >= row.verify_sent_at + service.EMAIL_CONFIRM_TTL):
        row.email = email
        row.verify_sent_at = now
        row.verification_mail_status = "pending"
        row.verification_mail_attempt_at = None
    db.commit()
    tasks.add_task(mail.send_verification, row.id, manual=True)
    return service.serialize(row)


@router.post("/product-feedback/{ticket_id}/email/confirm", dependencies=[Depends(no_cache)])
def confirm_email(ticket_id: str, payload: VerifyFeedbackEmail, request: Request,
                  tasks: BackgroundTasks, db: Session = Depends(get_db)):
    _limit(request, "email-confirm", 24)
    invalid = "确认链接已用过、失效或过期。需要时可以在原回执里重新发送。"
    if len(ticket_id) != 24:
        raise HTTPException(400, invalid)
    row = db.get(ProductFeedback, ticket_id)
    if row is None:
        raise HTTPException(400, invalid)
    row = service.lock_ticket(db, row)
    sent = row.verify_sent_at
    if (row.removed_at is not None or row.email_verified or not row.email or sent is None
        or utcnow() >= sent + service.EMAIL_CONFIRM_TTL
        or not hmac.compare_digest(payload.token, service.email_confirmation_token(row.id, row.email, sent))):
        raise HTTPException(400, invalid)
    row.email_verified = True
    db.commit()
    tasks.add_task(mail.notify_result, row.id)
    return {"verified": True}


@admin.get("", dependencies=[Depends(no_cache)])
def list_inbox(db: Session = Depends(get_db), offset: int = Query(0, ge=0, le=100_000),
               status: Literal["pending", "more_info", "awarded", "ready_to_pay", "needs_reconciliation",
                               "no_award", "expired", "released", "paid"] | None = None):
    pool = service.pilot_status(db, service.configured_pilot(), admin=True)
    query = select(ProductFeedback)
    expired = and_(ProductFeedback.status == "awarded", ProductFeedback.claim_until <= utcnow())
    if status == "expired":
        query = query.where(or_(ProductFeedback.status == "expired", expired))
    elif status == "awarded":
        query = query.where(ProductFeedback.status == status, ~expired)
    elif status is not None:
        query = query.where(ProductFeedback.status == status)
    records = db.scalars(query.order_by(ProductFeedback.created_at.desc(), ProductFeedback.id.desc())
                         .offset(offset).limit(31)).all()
    return {"items": [_serialize_admin(row) for row in records[:30]],
            "has_more": len(records) > 30, "pool": pool}


def _serialize_admin(row: ProductFeedback) -> dict:
    now = utcnow()
    return {
        **service.serialize(row, admin=True),
        "mail_needs_check": [kind for kind in mail.MAIL_FIELDS if mail.mail_retry_needs_check(row, kind, now)],
    }


@admin.get("/{ticket_id}", dependencies=[Depends(no_cache)])
def read_admin(row: ProductFeedback = Depends(admin_feedback), db: Session = Depends(get_db)):
    return _serialize_admin(service.expire_receipt(db, row))


@admin.post("/{ticket_id}/review", dependencies=[Depends(no_cache)])
def review(payload: ReviewFeedback, tasks: BackgroundTasks,
           row: ProductFeedback = Depends(admin_feedback), reviewer: User = Depends(get_admin_user),
           db: Session = Depends(get_db)):
    row = service.review_feedback(db, row, payload, reviewer.id)
    tasks.add_task(mail.notify_result, row.id)
    return _serialize_admin(row)


@admin.post("/{ticket_id}/paid", dependencies=[Depends(no_cache)])
def paid(payload: RecordPayout, row: ProductFeedback = Depends(admin_feedback),
         reviewer: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    return _serialize_admin(service.record_payout(
        db, row, decision="paid", reference=payload.reference, actor=reviewer.id,
    ))


@admin.post("/{ticket_id}/reconcile", dependencies=[Depends(no_cache)])
def reconcile(payload: ReconcilePayout, row: ProductFeedback = Depends(admin_feedback),
              reviewer: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    return _serialize_admin(service.record_payout(
        db, row, decision=payload.decision, reference=payload.reference, actor=reviewer.id, reconcile=True,
    ))


@admin.post("/{ticket_id}/retry-mail", status_code=202, dependencies=[Depends(no_cache)])
def retry_mail(tasks: BackgroundTasks, kind: Literal["owner", "result", "verification"] = Query("owner"),
               row: ProductFeedback = Depends(admin_feedback)):
    if mail.mail_retry_needs_check(row, kind, utcnow()):
        raise HTTPException(409, mail.CHECK_DELIVERY_DETAIL)
    if not email_actions_enabled():
        raise HTTPException(503, "邮件暂不可用，请检查发信配置。")
    deliver = {"owner": mail.notify_owner, "result": mail.notify_result, "verification": mail.send_verification}
    tasks.add_task(deliver[kind], row.id, manual=True)


@admin.post("/{ticket_id}/retry-ai", status_code=202, dependencies=[Depends(no_cache)])
def retry_ai(tasks: BackgroundTasks, row: ProductFeedback = Depends(admin_feedback),
             db: Session = Depends(get_db), client: DeepSeekClient = Depends(get_client)):
    row = service.lock_ticket(db, row)
    if row.removed_at is not None or row.ai_status not in ("pending", "failed"):
        raise HTTPException(409, "此反馈无需重新初筛。")
    if row.ai_status == "failed":
        row.ai_status = "pending"
        row.ai_attempt_at = None
    db.commit()
    tasks.add_task(mail.triage, row.id, client)
