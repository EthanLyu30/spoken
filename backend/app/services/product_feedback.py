"""Persist feedback independently of the pilot, and serialize reward decisions."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hmac
import json

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import feedback_key
from app.models.product_feedback import FeedbackPilot, ProductFeedback
from app.schemas.product_feedback import ReviewFeedback, SubmitFeedback
from app.services.account_mail import email_actions_enabled
from app.services.progress import utcnow

BUDGET = 200
EMAIL_CONFIRM_TTL = timedelta(hours=24)
EMAIL_RESEND_AFTER = timedelta(seconds=90)
CATEGORIES = {"ui": "界面与易用性", "feature": "功能建议", "bug": "故障",
              "learning": "练习与评分", "other": "其他"}
SOURCES = {"home": "首页", "profile": "我的", "scene_report": "课后小结",
           "interview_result": "面试结果", "direct": "反馈信箱"}
AI_RESULTS = {
    "reproducible": "提供了可核对的问题线索",
    "proposal": "提供了可讨论的改进方案",
    "needs_detail": "建议补充发生位置、操作或期望",
    "unclear": "由人工进一步判断",
}


@dataclass(frozen=True)
class Pilot:
    start: datetime

    # Changing the published dates must never allocate a second ¥200 budget.
    id = "pip-feedback-30-day"

    @property
    def end(self) -> datetime:
        return self.start + timedelta(days=30)


def configured_pilot() -> Pilot | None:
    try:
        start = datetime.fromisoformat(get_settings().feedback_pilot_starts_at)
        if start.tzinfo is not None:
            return Pilot(start.astimezone(timezone.utc).replace(tzinfo=None, microsecond=0))
    except ValueError:
        pass
    return None


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") + "Z" if value is not None else None


def _insert(db: Session, model):
    return sqlite_insert(model) if db.get_bind().dialect.name == "sqlite" else postgres_insert(model)


def _lock_pilot(db: Session, pilot_id: str) -> None:
    db.execute(_insert(db, FeedbackPilot).values(id=pilot_id, committed_amount=0).on_conflict_do_nothing())
    # The same write lock covers approval, expiry, and the first claim.
    db.execute(update(FeedbackPilot).where(FeedbackPilot.id == pilot_id)
               .values(committed_amount=FeedbackPilot.committed_amount))


def _release_budget(db: Session, pilot_id: str, amount: int) -> None:
    db.execute(update(FeedbackPilot).where(FeedbackPilot.id == pilot_id)
               .values(committed_amount=FeedbackPilot.committed_amount - amount))


def _expire(db: Session, pilot_id: str, now: datetime) -> None:
    amounts = db.scalars(update(ProductFeedback).where(
        ProductFeedback.pilot_id == pilot_id, ProductFeedback.status == "awarded",
        ProductFeedback.claim_until <= now,
    ).values(status="expired").returning(ProductFeedback.amount)).all()
    if amounts:
        _release_budget(db, pilot_id, sum(amounts))


def pilot_status(db: Session, pilot: Pilot | None, now: datetime | None = None, *, admin: bool = False) -> dict:
    now = now or utcnow()
    if pilot is None:
        return {"status": "unconfigured", "budget": BUDGET, "remaining": None, "starts_at": None, "ends_at": None}
    expired = db.scalar(select(ProductFeedback.id).where(
        ProductFeedback.pilot_id == pilot.id, ProductFeedback.status == "awarded",
        ProductFeedback.claim_until <= now,
    ).limit(1))
    if expired is not None:
        _lock_pilot(db, pilot.id)
        _expire(db, pilot.id, now)
        db.commit()
    committed = select(FeedbackPilot.committed_amount).where(FeedbackPilot.id == pilot.id).scalar_subquery()
    status = "upcoming" if now < pilot.start else "ended" if now >= pilot.end else "active"
    data = {"status": status, "budget": BUDGET, "starts_at": iso(pilot.start), "ends_at": iso(pilot.end)}
    if admin:
        held = select(func.coalesce(func.sum(ProductFeedback.amount), 0)).where(
            ProductFeedback.pilot_id == pilot.id, ProductFeedback.status == "needs_reconciliation",
        ).scalar_subquery()
        total, pending = db.execute(select(committed, held)).one()
        return {**data, "remaining": BUDGET - (total or 0), "reconciliation_amount": pending}
    return {**data, "remaining": BUDGET - (db.scalar(select(committed)) or 0)}


def store_feedback(db: Session, payload: SubmitFeedback, owner_id: int | None) -> tuple[ProductFeedback, bool]:
    now = utcnow()
    pilot = configured_pilot()
    pilot_id = pilot.id if pilot and pilot.start <= now < pilot.end else None
    ticket_id = feedback_key("ticket", payload.request_id)[:24]
    body = json.dumps([owner_id, payload.model_dump(exclude_none=True)], ensure_ascii=False, sort_keys=True)
    digest = feedback_key("submission", body)
    created = db.scalar(_insert(db, ProductFeedback).values(
        id=ticket_id, request_digest=digest, owner_id=owner_id, pilot_id=pilot_id,
        category=payload.category, description=payload.description, source=payload.source, created_at=now,
        ai_status="pending" if payload.allow_ai else "skipped", email=payload.email,
        verify_sent_at=now if payload.email else None,
    ).on_conflict_do_nothing().returning(ProductFeedback.id))
    record = db.get(ProductFeedback, ticket_id)
    if record is None or record.removed_at is not None or not hmac.compare_digest(record.request_digest, digest):
        raise HTTPException(409, "这次提交已被使用，请重新提交。")
    db.commit()
    return record, created is not None


def receipt_key(ticket_id: str) -> str:
    return feedback_key("receipt", ticket_id)


def email_confirmation_token(ticket_id: str, email: str, issued_at: datetime) -> str:
    return feedback_key("confirm-email", f"{ticket_id}/{issued_at.isoformat()}/{email}")


def verify_access(db: Session, ticket_id: str, secret: str | None, owner_id: int | None) -> ProductFeedback:
    record = db.get(ProductFeedback, ticket_id)
    if record is None or record.removed_at is not None or not (
        (secret is not None and hmac.compare_digest(secret, receipt_key(ticket_id)))
        or (owner_id is not None and owner_id == record.owner_id)
    ):
        raise HTTPException(404, "未找到回执，请打开完整的私密回执链接。")
    return record


def lock_ticket(db: Session, record: ProductFeedback, *, reward: bool = False) -> ProductFeedback:
    ticket_id, pilot_id = record.id, record.pilot_id
    if reward and pilot_id is not None:
        _lock_pilot(db, pilot_id)
    db.execute(update(ProductFeedback).where(ProductFeedback.id == ticket_id)
               .values(status=ProductFeedback.status))
    if reward and pilot_id is not None:
        _expire(db, pilot_id, utcnow())
    current = db.get(ProductFeedback, ticket_id, populate_existing=True)
    if current is None:
        raise HTTPException(404, "反馈不存在。")
    return current


def expire_receipt(db: Session, record: ProductFeedback) -> ProductFeedback:
    if record.status == "awarded" and record.claim_until is not None and record.claim_until <= utcnow():
        record = lock_ticket(db, record, reward=True)
        db.commit()
    return record


def review_feedback(db: Session, record: ProductFeedback, payload: ReviewFeedback, reviewer: int) -> ProductFeedback:
    row = lock_ticket(db, record, reward=True)
    status = {"award": "awarded", "more_info": "more_info", "no_award": "no_award"}[payload.decision]
    if row.status == status and row.amount == (payload.amount or 0) and row.review_note == payload.note:
        db.commit()
        return row
    if row.removed_at is not None or row.status not in ("pending", "more_info"):
        raise HTTPException(409, "这条反馈已经审核。")
    if payload.amount is not None:
        if row.pilot_id is None:
            raise HTTPException(409, "此反馈提交时不在奖励试行期内。")
        reserved = db.scalar(update(FeedbackPilot).where(
            FeedbackPilot.id == row.pilot_id, FeedbackPilot.committed_amount <= BUDGET - payload.amount,
        ).values(committed_amount=FeedbackPilot.committed_amount + payload.amount).returning(FeedbackPilot.id))
        if reserved is None:
            raise HTTPException(409, "剩余奖池不足，请选择其他符合标准的档位，或继续收录意见。")
        row.claim_until = utcnow().replace(microsecond=0) + timedelta(days=14)
    row.status = status
    row.amount = payload.amount or 0
    row.review_note = payload.note
    row.reviewer_id = reviewer
    row.reviewed_at = utcnow()
    row.result_mail_status = "pending"
    row.result_mail_attempt_at = None
    row.result_mail_started_at = None
    row.result_mail_ai_text = None
    db.commit()
    return row


def record_payout(db: Session, record: ProductFeedback, *, decision: str, reference: str,
                  actor: int, reconcile: bool = False) -> ProductFeedback:
    row = lock_ticket(db, record, reward=reconcile)
    if row.status == decision and row.payout_reference == reference:
        db.commit()
        return row
    if reconcile:
        if row.status != "needs_reconciliation" or row.pilot_id is None:
            raise HTTPException(409, "这笔奖励当前不需要核对。")
        if decision == "released":
            _release_budget(db, row.pilot_id, row.amount)
    elif row.status != "ready_to_pay" or row.removed_at is not None or not row.wechat:
        raise HTTPException(409, "这笔奖励不能直接标为已发放，请先核对转账记录。")
    now = utcnow()
    row.status = decision
    row.paid_at = now if decision == "paid" else None
    row.payout_recorded_at = now
    row.payout_recorded_by = actor
    row.payout_reference = reference
    row.wechat = None
    db.commit()
    return row


def displayed_status(record: ProductFeedback) -> str:
    if record.status == "awarded" and record.claim_until is not None and record.claim_until <= utcnow():
        return "expired"
    return record.status


def serialize(record: ProductFeedback, *, admin: bool = False) -> dict:
    data = {
        "id": record.id, "category": record.category, "description": record.description, "source": record.source,
        "supplement": record.supplement, "created_at": iso(record.created_at), "status": displayed_status(record),
        "ai_status": record.ai_status, "ai_result": record.ai_result, "review_note": record.review_note,
        "amount": record.amount, "claim_until": iso(record.claim_until), "paid_at": iso(record.paid_at),
        "email_verified": record.email_verified, "email_pending": record.email is not None and not record.email_verified,
        "verification_mail_status": record.verification_mail_status,
        "verification_expires_at": iso(record.verify_sent_at + EMAIL_CONFIRM_TTL) if record.verify_sent_at else None,
        "verification_retry_at": iso(record.verification_mail_attempt_at + EMAIL_RESEND_AFTER)
        if record.verification_mail_attempt_at else None,
        "email_notifications": email_actions_enabled(),
        "result_mail_status": record.result_mail_status,
        "claim_code": feedback_key("claim", record.id)[:8].upper() if record.status == "ready_to_pay" and record.wechat else None,
    }
    if admin:
        data.update({"owner_type": ("removed" if record.removed_at is not None else "account" if record.owner_id is not None else "guest"),
                     "pilot_eligible": record.pilot_id is not None, "wechat": record.wechat,
                     "owner_mail_status": record.owner_mail_status,
                     "payout_reference": record.payout_reference, "payout_recorded_at": iso(record.payout_recorded_at),
                     "payout_recorded_by": record.payout_recorded_by})
    return data


def erase_account_feedback(db: Session, user_id: int) -> None:
    # A claimed award may already have been transferred outside Spoken. Keep it
    # reserved for explicit reconciliation, while unclaimed awards release immediately.
    owned = ProductFeedback.owner_id == user_id
    pilot_ids = db.scalars(select(ProductFeedback.pilot_id).where(
        owned, ProductFeedback.pilot_id.is_not(None),
    ).distinct().order_by(ProductFeedback.pilot_id)).all()
    for pilot_id in pilot_ids:
        _lock_pilot(db, pilot_id)
        amounts = db.scalars(update(ProductFeedback).where(
            owned, ProductFeedback.pilot_id == pilot_id,
            ProductFeedback.status == "awarded",
        ).values(status="expired").returning(ProductFeedback.amount)).all()
        if amounts:
            _release_budget(db, pilot_id, sum(amounts))
    db.execute(update(ProductFeedback).where(owned, ProductFeedback.status == "ready_to_pay")
               .values(status="needs_reconciliation"))
    db.execute(update(ProductFeedback).where(owned).values(
        owner_id=None, removed_at=utcnow(), description="", supplement="", email=None,
        email_verified=False, verify_sent_at=None, wechat=None, review_note="",
    ))


def export_account_feedback(db: Session, user_id: int) -> list[dict]:
    rows = db.scalars(select(ProductFeedback).where(ProductFeedback.owner_id == user_id)
                      .order_by(ProductFeedback.created_at, ProductFeedback.id))
    return [{**serialize(row), "wechat": row.wechat, "email": row.email} for row in rows]
