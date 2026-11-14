import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from time import monotonic, sleep
from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update

from app.core.config import get_settings
from app.core.ratelimit import SlidingWindowLimiter
from app.db import SessionLocal, engine
from app.main import app
from app.models.product_feedback import FeedbackPilot, ProductFeedback
from app.models.telemetry import AdminAccount
from app.models.user import User
from app.services.progress import utcnow


@pytest.fixture
def inbox(monkeypatch):
    from app.services.product_feedback import Pilot

    monkeypatch.setattr(Pilot, "id", uuid4().hex)
    monkeypatch.setenv("FEEDBACK_PILOT_STARTS_AT", (utcnow() - timedelta(days=1)).isoformat() + "Z")
    monkeypatch.setattr("app.main.recover_notifications", lambda _client: asyncio.Event().wait())
    monkeypatch.setenv("FEEDBACK_NOTIFY_EMAIL", "owner@example.test")
    monkeypatch.setenv("RESEND_API_KEY", "test-mail-key")
    monkeypatch.setenv("ACCOUNT_MAIL_FROM", "Spoken <sender@example.test>")
    monkeypatch.setenv("ACCOUNT_PUBLIC_ORIGIN", "https://spoken.example.test")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.setattr("app.api.product_feedback.limiter", SlidingWindowLimiter())
    monkeypatch.setattr("app.main.limiter", SlidingWindowLimiter())
    monkeypatch.setattr("app.services.feedback_notifications.limiter", SlidingWindowLimiter())
    get_settings.cache_clear()
    mail = []
    def post(url, **kwargs):
        assert url == "https://api.resend.com/emails"
        mail.append(kwargs)
        return httpx.Response(200, json={"id": f"mail-{len(mail)}"}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    try:
        with TestClient(app) as client:
            yield client, mail
    finally:
        with SessionLocal.begin() as db:
            db.query(ProductFeedback).filter_by(pilot_id=Pilot.id).delete()
            db.query(FeedbackPilot).filter_by(id=Pilot.id).delete()
        get_settings.cache_clear()


def submit(client, headers=None, **fields):
    payload = {"request_id": uuid4().hex, "category": "bug",
               "description": "录音结束后没有看到重试入口。", "source": "scene_report", **fields}
    response = client.post("/api/product-feedback", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json(), payload


def admin_token(client):
    email = f"{uuid4().hex}@example.test"
    response = client.post("/api/auth/register", json={"email": email, "password": "test-password"})
    assert response.status_code == 201
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        db.add(AdminAccount(user_id=user.id))
        db.commit()
    return {"Authorization": "Bearer " + response.json()["token"]}


def review(client, admin, item, amount, **fields):
    return client.post(f"/api/admin/product-feedback/{item['id']}/review", headers=admin,
                       json={"decision": "award", "amount": amount, "note": "已验证问题。", **fields})


def get_receipt(client, item):
    return client.get(f"/api/product-feedback/{item['id']}", headers={"X-Feedback-Key": item["receipt_key"]})


def test_feedback_is_saved_once_and_private(inbox):
    client, mail = inbox
    item, payload = submit(client)
    assert item["status"] == "pending"
    assert get_receipt(client, item).json()["description"] == payload["description"]
    assert client.get(f"/api/product-feedback/{item['id']}").status_code == 404
    assert get_receipt(client, {**item, "receipt_key": "f" * 64}).status_code == 404
    assert client.get("/api/admin/product-feedback").status_code == 401
    unrelated = client.post("/api/auth/register", json={"email": f"{uuid4().hex}@example.test", "password": "test-password"})
    token = {"Authorization": "Bearer " + unrelated.json()["token"]}
    assert client.get("/api/admin/product-feedback", headers=token).status_code == 403
    assert client.get(f"/api/product-feedback/{item['id']}", headers=token).status_code == 404
    repeated = client.post("/api/product-feedback", json=payload)
    assert repeated.json()["receipt_key"] == item["receipt_key"]
    assert len([m for m in mail if m["json"]["to"] == ["owner@example.test"]]) == 1
    notice = mail[0]["json"]
    assert item["id"] in notice["text"]
    assert item["receipt_key"] not in notice["text"]
    assert payload["description"] in notice["text"]


def test_approval_reserves_and_wechat_is_only_for_an_awarded_receipt(inbox):
    client, mail = inbox
    admin = admin_token(client)
    item, _ = submit(client)
    claim = f"/api/product-feedback/{item['id']}/claim"
    key = {"X-Feedback-Key": item["receipt_key"]}
    assert client.put(claim, headers=key, json={"wechat": "wx-demo-01"}).status_code == 409
    assert review(client, admin, item, 25).status_code == 200
    assert review(client, admin, item, 25).status_code == 200
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 175
    assert client.put(claim, headers=key, json={"wechat": "wx-demo-01"}).status_code == 200
    assert get_receipt(client, item).json()["status"] == "ready_to_pay"
    assert client.post(f"/api/admin/product-feedback/{item['id']}/paid", headers=admin, json={"reference": "账单尾号 A1B2"}).status_code == 200
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 175
    assert get_receipt(client, item).json()["status"] == "paid"
    assert "wx-demo-01" not in json.dumps(mail)


def test_budget_update_is_atomic_and_full_pilot_still_accepts_feedback(inbox):
    client, _ = inbox
    admin = admin_token(client)
    for _ in range(3):
        item, _ = submit(client)
        assert review(client, admin, item, 50).status_code == 200
    left, _ = submit(client)
    right, _ = submit(client)
    start = Barrier(2)
    def try_review(item):
        start.wait(timeout=5)
        return review(client, admin, item, 50).status_code

    with ThreadPoolExecutor(max_workers=2) as threads:
        results = list(threads.map(try_review, [left, right]))
    assert sorted(results) == [200, 409]
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 0
    assert submit(client)[0]["status"] == "pending"
    from app.services.product_feedback import Pilot
    with SessionLocal() as db:
        total = db.scalar(select(func.sum(ProductFeedback.amount)).where(
            ProductFeedback.pilot_id == Pilot.id, ProductFeedback.status == "awarded",
        ))
        assert db.get(FeedbackPilot, Pilot.id).committed_amount == total == 200


def test_only_verified_email_gets_both_review_results(inbox, monkeypatch):
    client, mail = inbox
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-model-key")
    monkeypatch.setenv("FEEDBACK_AI_ENABLED", "true")
    get_settings.cache_clear()
    from app.services.deepseek import DeepSeekClient

    async def triage(_client, messages, **_kwargs):
        assert "录音结束" in messages[-1]["content"]
        return '{"status":"reproducible"}'

    monkeypatch.setattr(DeepSeekClient, "chat", triage)
    recipient = "feedback-reader@example.test"
    item, payload = submit(client, allow_ai=True, email=recipient)
    assert item["email_pending"] and not item["email_verified"]
    assert "email" not in item
    verification = next(entry["json"] for entry in mail if entry["json"]["to"] == [recipient])
    assert item["receipt_key"] not in verification["text"]
    assert payload["description"] not in verification["text"]
    confirmation = re.search(r"https://\S+/feedback/confirm/([a-f0-9]{24})#token=([a-f0-9]{64})", verification["text"])
    assert confirmation.group(1) == item["id"]
    assert client.post("/api/product-feedback", json=payload).json()["id"] == item["id"]
    assert len(mail) == 2
    token = confirmation.group(2)
    path = f"/api/product-feedback/{item['id']}/email/confirm"
    admin = admin_token(client)
    assert review(client, admin, item, 10).status_code == 200
    assert len(mail) == 2
    assert client.post(path, json={"token": "0" * 64}).status_code == 400
    assert len(mail) == 2
    confirmed = client.post(path, json={"token": token})
    assert confirmed.status_code == 200 and confirmed.json() == {"verified": True}
    result = mail[-1]["json"]
    assert result["to"] == [recipient]
    assert "AI 初筛：提供了可核对的问题线索" in result["text"]
    assert "人工审核：审核通过，现金答谢 ¥10" in result["text"]
    assert "已验证问题。" in result["text"]
    assert f"/feedback/receipt/{item['id']}" in result["text"]
    assert item["receipt_key"] not in result["text"]
    assert client.post(path, json={"token": token}).status_code == 400
    assert client.get(f"/api/admin/product-feedback/{item['id']}", headers=admin).json()["result_mail_status"] == "sent"
    assert get_receipt(client, item).json()["result_mail_status"] == "sent"


def test_unclaimed_award_releases_budget_at_deadline(inbox):
    client, _ = inbox
    admin = admin_token(client)
    item, _ = submit(client)
    assert review(client, admin, item, 25).status_code == 200
    with SessionLocal.begin() as db:
        db.get(ProductFeedback, item["id"]).claim_until = utcnow() - timedelta(seconds=1)
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 200
    assert get_receipt(client, item).json()["status"] == "expired"
    assert client.put(f"/api/product-feedback/{item['id']}/claim",
                      headers={"X-Feedback-Key": item["receipt_key"]}, json={"wechat": "expired-123"}).status_code == 409


def test_erasing_an_account_releases_unclaimed_awards_and_preserves_paid_totals(inbox):
    client, _ = inbox
    admin = admin_token(client)
    email = f"{uuid4().hex}@example.test"
    created = client.post("/api/auth/register", json={"email": email, "password": "test-password"})
    assert created.status_code == 201
    headers = {"Authorization": "Bearer " + created.json()["token"]}
    paid, _ = submit(client, headers=headers)
    unpaid, _ = submit(client, headers=headers)
    for item in (paid, unpaid):
        assert review(client, admin, item, 25).status_code == 200
    claim = f"/api/product-feedback/{paid['id']}/claim"
    assert client.put(claim, headers=headers, json={"wechat": "wx-demo"}).status_code == 200
    assert client.post(f"/api/admin/product-feedback/{paid['id']}/paid", headers=admin, json={"reference": "账单尾号 A1B2"}).status_code == 200
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 150
    assert len(client.get("/api/product-feedback/mine", headers=headers).json()) == 2
    assert client.request("DELETE", "/api/auth/me", headers=headers, json={"password": "test-password"}).status_code == 204
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 175
    assert get_receipt(client, paid).status_code == 404
    assert get_receipt(client, unpaid).status_code == 404
    kept = client.get(f"/api/admin/product-feedback/{paid['id']}", headers=admin).json()
    assert kept["owner_type"] == "removed" and kept["status"] == "paid"
    assert kept["description"] == "" and kept["wechat"] is None


def test_review_can_arrive_after_confirmation_and_recover_delivery(inbox, monkeypatch):
    from app.services import feedback_notifications

    client, mail = inbox
    recipient = "recovery@example.test"
    post = httpx.post
    attempts = []

    def fail_first_verification(url, **kwargs):
        if kwargs["json"]["to"] == [recipient] and not attempts:
            attempts.append(kwargs["headers"]["Idempotency-Key"])
            return httpx.Response(503, request=httpx.Request("POST", url))
        return post(url, **kwargs)

    monkeypatch.setattr(httpx, "post", fail_first_verification)
    item, _ = submit(client, email=recipient)
    assert get_receipt(client, item).json()["verification_mail_status"] == "failed"
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.verification_mail_attempt_at = utcnow() - timedelta(minutes=10)

    feedback_notifications.retry_pending_mail()
    verification = next(entry for entry in mail if entry["json"]["to"] == [recipient])
    assert verification["headers"]["Idempotency-Key"] == attempts[0]
    token = re.search(r"#token=([a-f0-9]{64})", verification["json"]["text"]).group(1)
    assert client.post(f"/api/product-feedback/{item['id']}/email/confirm", json={"token": token}).status_code == 200
    assert len([entry for entry in mail if entry["json"]["to"] == [recipient]]) == 1
    admin = admin_token(client)
    assert review(client, admin, item, 25).status_code == 200
    assert "直接人工审核" in mail[-1]["json"]["text"]
    assert "现金答谢 ¥25" in mail[-1]["json"]["text"]


def test_replaced_or_expired_confirmation_cannot_activate_email(inbox):
    client, mail = inbox
    item, _ = submit(client, email="mistake@example.test")
    first = re.search(r"#token=([a-f0-9]{64})", mail[0]["json"]["text"]).group(1)
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.verify_sent_at -= timedelta(days=2)
        row.verification_mail_attempt_at -= timedelta(days=2)
    path = f"/api/product-feedback/{item['id']}/email"
    assert client.post(f"{path}/confirm", json={"token": first}).status_code == 400
    key = {"X-Feedback-Key": item["receipt_key"]}
    assert client.post(path, json={"email": "correct@example.test"}, headers=key).status_code == 202
    last = re.search(r"#token=([a-f0-9]{64})", mail[-1]["json"]["text"]).group(1)
    assert client.post(f"{path}/confirm", json={"token": first}).status_code == 400
    assert client.post(f"{path}/confirm", json={"token": last}).status_code == 200


def test_same_trial_keeps_its_budget_when_start_time_changes(inbox, monkeypatch):
    client, _ = inbox
    admin = admin_token(client)
    item, _ = submit(client)
    assert review(client, admin, item, 25).status_code == 200
    monkeypatch.setenv("FEEDBACK_PILOT_STARTS_AT", (utcnow() - timedelta(days=2)).isoformat() + "Z")
    get_settings.cache_clear()
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 175


def test_mail_disabled_and_invalid_address_are_handled_separately(inbox, monkeypatch):
    client, mail = inbox
    bad = client.post("/api/product-feedback", json={
        "request_id": uuid4().hex, "category": "bug", "description": "录音结束后没有看到重试入口。",
        "email": "an-invalid-address",
    })
    assert bad.status_code == 422 and not mail
    monkeypatch.setenv("RESEND_API_KEY", "")
    get_settings.cache_clear()
    item, _ = submit(client, email="queued@example.test")
    assert item["email_pending"] and item["email_notifications"] is False
    assert get_receipt(client, item).json()["status"] == "pending"
    assert not mail


@pytest.mark.parametrize("kind", ["owner", "result", "verification"])
def test_old_ambiguous_delivery_requires_check_instead_of_retry(inbox, kind):
    from app.services import feedback_notifications

    client, mail = inbox
    item, _ = submit(client, email="old-delivery@example.test")
    admin = admin_token(client)
    original_count = len(mail)
    started = utcnow() - timedelta(hours=20, seconds=1)
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        if kind == "result":
            row.email_verified = True
            row.status = "no_award"
            row.reviewed_at = started
            row.review_note = "已收录。"
        first_attempt_field = "verify_sent_at" if kind == "verification" else f"{kind}_mail_started_at"
        setattr(row, first_attempt_field, started)
        setattr(row, f"{kind}_mail_attempt_at", utcnow() - timedelta(minutes=6))
        setattr(row, f"{kind}_mail_status", "sending")

    path = f"/api/admin/product-feedback/{item['id']}"
    detail = client.get(path, headers=admin).json()
    assert detail["mail_needs_check"] == [kind]
    listed = client.get("/api/admin/product-feedback", headers=admin).json()["items"]
    assert next(record for record in listed if record["id"] == item["id"])["mail_needs_check"] == [kind]
    retry = client.post(f"{path}/retry-mail", params={"kind": kind}, headers=admin)
    assert retry.status_code == 409
    assert "先核对投递记录" in retry.json()["detail"]

    # The worker must still enforce the cutoff if an accepted request waits in a queue.
    feedback_notifications.retry_pending_mail()
    feedback_notifications._deliver_mail(item["id"], kind, manual=True)
    assert len(mail) == original_count
    assert client.get(path, headers=admin).json()[f"{kind}_mail_status"] == "sending"


def test_admin_can_retry_within_window_and_send_old_unattempted_mail(inbox):
    client, mail = inbox
    admin = admin_token(client)
    item, _ = submit(client)
    original = mail[-1]
    path = f"/api/admin/product-feedback/{item['id']}/retry-mail?kind=owner"
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.owner_mail_started_at = row.owner_mail_attempt_at = utcnow() - timedelta(hours=19)
        row.owner_mail_status = "failed"
    assert client.post(path, headers=admin).status_code == 202
    assert len(mail) == 2
    assert mail[-1]["headers"]["Idempotency-Key"] == original["headers"]["Idempotency-Key"]
    assert mail[-1]["json"] == original["json"]

    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.created_at -= timedelta(days=2)
        row.owner_mail_started_at = row.owner_mail_attempt_at = None
        row.owner_mail_status = "pending"
    assert client.post(path, headers=admin).status_code == 202
    assert len(mail) == 3


def test_expired_confirmation_can_be_replaced_without_retrying_old_delivery(inbox):
    client, mail = inbox
    item, _ = submit(client, email="replace-confirmation@example.test")
    old_key = mail[0]["headers"]["Idempotency-Key"]
    path = f"/api/product-feedback/{item['id']}/email"
    headers = {"X-Feedback-Key": item["receipt_key"]}
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.verify_sent_at = row.verification_mail_attempt_at = utcnow() - timedelta(hours=21)
        row.verification_mail_status = "failed"
    retry = client.post(path, headers=headers, json={})
    assert retry.status_code == 409
    assert len(mail) == 2

    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.verify_sent_at -= timedelta(hours=4)
    assert client.post(path, headers=headers, json={}).status_code == 202
    assert len(mail) == 3
    assert mail[-1]["headers"]["Idempotency-Key"] != old_key


@pytest.mark.parametrize("resolution", ["paid", "released"])
def test_deleted_claim_requires_manual_reconciliation(inbox, resolution):
    client, _ = inbox
    admin = admin_token(client)
    created = client.post("/api/auth/register", json={
        "email": f"{uuid4().hex}@example.test", "password": "test-password",
    })
    user = {"Authorization": f"Bearer {created.json()['token']}"}
    item, _ = submit(client, headers=user)
    path = f"/api/admin/product-feedback/{item['id']}"
    assert review(client, admin, item, 10).status_code == 200
    assert client.put(f"/api/product-feedback/{item['id']}/claim", headers=user, json={"wechat": "demo-wechat"}).status_code == 200
    assert client.request("DELETE", "/api/auth/me", headers=user, json={"password": "test-password"}).status_code == 204
    detail = client.get(path, headers=admin).json()
    assert detail["status"] == "needs_reconciliation"
    assert detail["owner_type"] == "removed" and detail["wechat"] is None
    assert get_receipt(client, item).status_code == 404
    assert client.post(f"{path}/paid", headers=admin, json={"reference": "账单末尾 A1B2"}).status_code == 409
    pool = client.get("/api/admin/product-feedback", headers=admin).json()["pool"]
    assert (pool["remaining"], pool["reconciliation_amount"]) == (190, 10)
    assert client.post(f"{path}/reconcile", headers=admin, json={"decision": resolution, "reference": "  "}).status_code == 422
    decision = {"decision": resolution, "reference": "账单末尾 A1B2，已核对"}
    reply = client.post(f"{path}/reconcile", headers=admin, json=decision)
    assert reply.status_code == 200
    assert reply.json()["status"] == resolution
    assert reply.json()["payout_reference"] == decision["reference"]
    assert reply.json()["payout_recorded_at"]
    assert client.post(f"{path}/reconcile", headers=admin, json=decision).status_code == 200
    assert client.post(f"{path}/reconcile", headers=admin, json={
        "decision": "released" if resolution == "paid" else "paid",
        "reference": "另一个结果",
    }).status_code == 409
    pool = client.get("/api/admin/product-feedback", headers=admin).json()["pool"]
    assert (pool["remaining"], pool["reconciliation_amount"]) == (190 if resolution == "paid" else 200, 0)


def test_render_feedback_limit_separates_clients_and_ignores_untrusted_headers(inbox, monkeypatch):
    client, _ = inbox
    def attempt(ip):
        return client.post("/api/product-feedback", headers={
            "CF-Connecting-IP": ip, "CF-Ray": "123abc-SIN", "X-Forwarded-For": "198.51.100.2",
        }, json={"request_id": uuid4().hex, "category": "ui", "description": "测试来信，用于确认反馈限流。"})

    monkeypatch.setenv("RENDER", "true")
    for _ in range(24):
        assert attempt("203.0.113.11").status_code == 201
    assert attempt("203.0.113.11").status_code == 429
    assert attempt("203.0.113.12").status_code == 201

    monkeypatch.delenv("RENDER")
    for _ in range(24):
        assert attempt("203.0.113.12").status_code == 201
    assert attempt("203.0.113.13").status_code == 429


def test_award_mail_receipt_and_claim_share_one_deadline(inbox, monkeypatch):
    from app.api import product_feedback as api
    from app.services import product_feedback as service

    client, mail = inbox
    item, _ = submit(client, email="deadline@example.test")
    token = re.search(r"#token=([a-f0-9]{64})", mail[0]["json"]["text"]).group(1)
    assert client.post(f"/api/product-feedback/{item['id']}/email/confirm", json={"token": token}).status_code == 200
    admin = admin_token(client)
    awarded = review(client, admin, item, 25).json()
    assert "领取截止" in mail[-1]["json"]["text"]
    assert "UTC+08:00" in mail[-1]["json"]["text"]
    written = re.search(r"领取截止 (.{19})", mail[-1]["json"]["text"]).group(1)
    displayed = datetime.fromisoformat(written).replace(tzinfo=timezone(timedelta(hours=8)))
    deadline = datetime.fromisoformat(awarded["claim_until"])
    assert displayed == deadline
    assert get_receipt(client, item).json()["claim_until"] == awarded["claim_until"]
    monkeypatch.setattr(service, "utcnow", lambda: deadline.replace(tzinfo=None))
    monkeypatch.setattr(api, "utcnow", lambda: deadline.replace(tzinfo=None))
    assert client.put(f"/api/product-feedback/{item['id']}/claim", headers={"X-Feedback-Key": item["receipt_key"]},
                      json={"wechat": "at-the-deadline"}).status_code == 409
    assert client.get("/api/product-feedback/pilot").json()["remaining"] == 200


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="requires PostgreSQL row locks")
@pytest.mark.parametrize("boundary", ["before", "after"])
def test_claim_waiting_for_the_row_uses_the_actual_deadline(inbox, monkeypatch, boundary):
    from app.services import product_feedback as service

    client, _ = inbox
    admin = admin_token(client)
    claimed, _ = submit(client)
    contender, _ = submit(client)
    assert review(client, admin, claimed, 50).status_code == 200
    for _ in range(3):
        item, _ = submit(client)
        assert review(client, admin, item, 50).status_code == 200
    deadline = utcnow() + timedelta(seconds=1)
    clock = [deadline - timedelta(microseconds=1)]
    monkeypatch.setattr(service, "utcnow", lambda: clock[0])
    waiting = Event()
    claimant_pids = []
    original = service._lock_pilot

    def signal_pilot(db, pilot_id):
        original(db, pilot_id)
        if not waiting.is_set():
            claimant_pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            waiting.set()

    monkeypatch.setattr(service, "_lock_pilot", signal_pilot)
    with ThreadPoolExecutor(max_workers=2) as threads:
        with SessionLocal.begin() as db:
            db.execute(update(ProductFeedback).where(ProductFeedback.id == claimed["id"])
                       .values(claim_until=deadline))
        with SessionLocal.begin() as db:
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(select(ProductFeedback.id).where(ProductFeedback.id == claimed["id"]).with_for_update())
            claim = threads.submit(client.put, f"/api/product-feedback/{claimed['id']}/claim",
                                   headers={"X-Feedback-Key": claimed["receipt_key"]},
                                   json={"wechat": "deadline-demo"})
            assert waiting.wait(timeout=5)
            with SessionLocal() as monitor:
                stop_at = monotonic() + 5
                while not monitor.scalar(text("SELECT cardinality(pg_blocking_pids(:pid))"), {"pid": claimant_pids[0]}):
                    if monotonic() >= stop_at:
                        pytest.fail("Claim did not block on the locked feedback row")
                    sleep(0.02)
            if boundary == "after":
                clock[0] = deadline
            competing_review = threads.submit(review, client, admin, contender, 50)
        claim_status = claim.result(timeout=10).status_code
        review_status = competing_review.result(timeout=10).status_code
    assert (claim_status, review_status) == ((200, 409) if boundary == "before" else (409, 200))
    with SessionLocal() as db:
        pilot = db.get(FeedbackPilot, service.Pilot.id)
        active_amount = db.scalar(select(func.sum(ProductFeedback.amount)).where(
            ProductFeedback.pilot_id == pilot.id,
            ProductFeedback.status.in_(["awarded", "ready_to_pay", "needs_reconciliation", "paid"]),
        ))
        assert pilot.committed_amount == active_amount == 200


def test_result_mail_retry_keeps_original_payload_after_ai_recheck(inbox, monkeypatch):
    from app.services import feedback_notifications as service

    client, mail = inbox
    recipient = "retry-ai-result@example.test"
    item, _ = submit(client, email=recipient)
    confirm = re.search(r"#token=([a-f0-9]{64})", mail[0]["json"]["text"]).group(1)
    assert client.post(f"/api/product-feedback/{item['id']}/email/confirm", json={"token": confirm}).status_code == 200
    with SessionLocal.begin() as db:
        db.get(ProductFeedback, item["id"]).ai_status = "failed"
    post = httpx.post
    attempts = []

    def timeout_after_provider_accept(url, **kwargs):
        if kwargs["headers"].get("Idempotency-Key", "").startswith("feedback-result/"):
            attempts.append((kwargs["headers"]["Idempotency-Key"], kwargs["json"]))
            if len(attempts) == 1:
                raise httpx.ReadTimeout("provider accepted before socket timeout")
            assert attempts[0] == attempts[-1]
        return post(url, **kwargs)

    monkeypatch.setattr(httpx, "post", timeout_after_provider_accept)
    assert review(client, admin_token(client), item, 25).status_code == 200
    assert get_receipt(client, item).json()["result_mail_status"] == "failed"
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        row.result_mail_attempt_at = utcnow() - timedelta(minutes=6)
        row.ai_status, row.ai_result = "done", "提供了可核对的问题线索"
    service.retry_pending_mail()
    assert len(attempts) == 2
    assert get_receipt(client, item).json()["result_mail_status"] == "sent"


def test_queued_owner_mail_retries_from_its_first_actual_attempt(inbox, monkeypatch):
    from app.services import feedback_notifications as service

    client, mail = inbox
    monkeypatch.setenv("RESEND_API_KEY", "")
    get_settings.cache_clear()
    item, _ = submit(client)
    with SessionLocal.begin() as db:
        db.get(ProductFeedback, item["id"]).created_at -= timedelta(days=3)
    monkeypatch.setenv("RESEND_API_KEY", "test-mail-key")
    get_settings.cache_clear()
    post = httpx.post
    attempts = []

    def fail_once(url, **kwargs):
        attempts.append(kwargs["headers"]["Idempotency-Key"])
        if len(attempts) == 1:
            return httpx.Response(503, request=httpx.Request("POST", url))
        return post(url, **kwargs)

    monkeypatch.setattr(httpx, "post", fail_once)
    service.retry_pending_mail()
    with SessionLocal.begin() as db:
        row = db.get(ProductFeedback, item["id"])
        assert row.owner_mail_status == "failed" and row.owner_mail_started_at
        row.owner_mail_attempt_at = utcnow() - timedelta(minutes=6)
    service.retry_pending_mail()
    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert len(mail) == 1
