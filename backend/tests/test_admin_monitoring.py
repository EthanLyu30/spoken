"""Visitor identity, honest reference pricing and idle retention regressions."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, func

from app.main import app
from app.db import SessionLocal
from app.core.config import get_settings
from tests.test_observability import account


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(get_settings(), 'jwt_secret', 'monitoring-local-test-secret-0123456789abcdef')
    from app.api.telemetry import _rates
    _rates.clear()
    with TestClient(app) as value:
        yield value


def reset_visits():
    from app.models.monitoring import SiteVisit
    with SessionLocal() as db:
        db.execute(delete(SiteVisit))
        db.commit()


def model_row(model='deepseek-flash', input_tokens=1000, output_tokens=500, outcome='ok'):
    return SimpleNamespace(model=model, input_tokens=input_tokens, output_tokens=output_tokens, outcome=outcome)


def test_reference_price_range_counts_reported_cancellation_but_not_unknown_usage():
    from app.services.model_pricing import pricing_summary
    data = pricing_summary([model_row(), model_row(outcome='cancelled'),
        model_row(input_tokens=None), model_row(model='unpriced-model'), model_row(model=None, input_tokens=None, output_tokens=None)])
    assert data['configured_model'] == 'deepseek-flash'
    assert data['priced_records'] == 2
    assert data['model_records'] == 4
    assert data['unknown_usage_records'] == 1
    assert data['unpriced_records'] == 1
    assert data['min_cny'] == pytest.approx(2 * (1000 * .02 + 500 * 4) / 1_000_000)
    assert data['max_cny'] == pytest.approx(2 * (1000 * 2 + 500 * 8) / 1_000_000)
    assert data['checked_at'] == '2026-10-31'


def test_missing_cost_is_unknown_and_real_zero_usage_stays_zero():
    from app.services.model_pricing import pricing_summary
    assert pricing_summary([])['min_cny'] is None
    assert pricing_summary([model_row(input_tokens=None)])['max_cny'] is None
    assert pricing_summary([model_row(input_tokens=0, output_tokens=0)])['max_cny'] == 0
    assert pricing_summary([model_row()], source='browser')['min_cny'] is None


def test_usage_without_model_metadata_is_reported_as_unpriced():
    from app.services.model_pricing import pricing_summary
    data = pricing_summary([model_row(model=None)])
    assert data['model_records'] == 1 and data['unpriced_records'] == 1
    assert data['min_cny'] is None


def test_test_traffic_filter_matches_cards_and_drilldown(client):
    from app.models.telemetry import TelemetryRecord

    owner = account(client, admin=True)
    release = uuid.uuid4().hex
    with SessionLocal() as db:
        for run, outcome in [(None, "ok"), ("smoke-a", "error"), ("smoke-b", "ok")]:
            db.add_all([
                TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=utcnow(), release=release, source="server",
                                operation="POST /api/chat/stream", outcome=outcome,
                                duration_ms=100, ttft_ms=50, test_run_id=run),
                TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=utcnow(), release=release, source="browser",
                                operation="speech.complete", outcome=outcome,
                                duration_ms=100, test_run_id=run),
            ])
        db.commit()

    try:
        for filters, total, errors in [({}, 3, 1), ({"traffic": "unmarked"}, 1, 0),
                                       ({"traffic": "test"}, 2, 1), ({"test_run_id": "smoke-a"}, 1, 1)]:
            base = {"release": release, **filters}
            data = client.get("/api/admin/overview", headers=owner, params={**base, "include_experience": True}).json()
            assert (data["count"], data["errors"]) == (total, errors)
            assert data["experience"]["stages"][0]["samples"] == total - errors
            assert data["experience"]["playback"]["failed"] == errors
            rows = client.get("/api/admin/traces", headers=owner, params={**base, "source": "browser"}).json()
            assert rows["total"] == total
            if filters.get("test_run_id"):
                assert [row["test_run_id"] for row in rows["items"]] == ["smoke-a"]

        capacity = data["collection"]["sources"]
        assert capacity["server"]["source_budget"] == 15000
        assert capacity["browser"]["source_budget"] == 5000
    finally:
        with SessionLocal() as db:
            db.execute(delete(TelemetryRecord).where(TelemetryRecord.release == release))
            db.commit()


def test_out_of_order_visit_updates_preserve_first_and_last_seen(client):
    from app.services.monitoring import record_visit
    from app.models.monitoring import SiteVisit
    reset_visits()
    now = utcnow().replace(hour=12, minute=0, second=0)
    with SessionLocal() as db:
        record_visit(db, 'concurrent-browser', at=now)
        record_visit(db, 'concurrent-browser', at=now - timedelta(seconds=5))
        row = db.scalar(select(SiteVisit))
        assert row.last_seen_at == now
        assert row.first_seen_at == now - timedelta(seconds=5)


def test_admin_user_list_returns_accounts_but_not_admin_identity(client):
    owner = account(client, admin=True)
    ordinary = account(client)
    ordinary_user = client.get('/api/auth/me', headers=ordinary).json()
    response = client.get('/api/admin/users', headers=owner)
    assert response.status_code == 200
    body = response.json()
    emails = {item['email'] for item in body['items']}
    assert ordinary_user['email'] in emails
    assert not ordinary_user.get('is_admin')
    assert body['registered'] == len(body['items'])
    assert '访客' in body['note']
    assert client.get('/api/admin/users', headers=ordinary).status_code == 403


def test_user_page_counts_all_accounts_and_sorts_by_durable_activity(client):
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from app.api.admin import list_users
    from app.db import Base
    from app.models.progress import LearningEvent
    from app.models.telemetry import AdminAccount
    from app.models.user import User

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = utcnow()
    with Session(engine) as db:
        db.add_all([
            User(id=i, email=f"u{i}@example.test", password_hash="unused", created_at=now - timedelta(days=2, minutes=110-i))
            for i in range(1, 107)
        ])
        db.flush()
        db.add(AdminAccount(user_id=106))
        db.add_all([
            LearningEvent(event_key="latest", client_id="u:1", event_type="word_reviewed", occurred_at=now),
            LearningEvent(event_key="activated", client_id="u:2", event_type="practice", occurred_at=now - timedelta(days=2)),
            LearningEvent(event_key="before-register", client_id="u:3", event_type="practice", occurred_at=now - timedelta(days=3)),
            LearningEvent(event_key="late", client_id="u:4", event_type="practice",
                          occurred_at=now - timedelta(days=1, minutes=106) + timedelta(microseconds=1)),
            LearningEvent(event_key="exactly-24h", client_id="u:5", event_type="practice",
                          occurred_at=now - timedelta(days=1, minutes=105)),
            LearningEvent(event_key="guest-session", client_id="guest-a", event_type="session", occurred_at=now),
            LearningEvent(event_key="guest-pronunciation", client_id="guest-a", event_type="practice",
                          kind="pronunciation", occurred_at=now),
            LearningEvent(event_key="guest-interview", client_id="guest-b", event_type="practice",
                          kind="interview", occurred_at=now),
            LearningEvent(event_key="guest-review", client_id="guest-b", event_type="word_reviewed", occurred_at=now),
            LearningEvent(event_key="guest-collect", client_id="guest-b", event_type="word_collected", occurred_at=now),
            LearningEvent(event_key="old-guest", client_id="guest-c", event_type="session", occurred_at=now - timedelta(days=8)),
            LearningEvent(event_key="legacy-anon", client_id="anon", event_type="session", occurred_at=now),
        ])
        db.commit()
        queries = []
        event.listen(engine, "before_cursor_execute", lambda *args: queries.append(args[2]))
        result = list_users(db, limit=20, offset=0, search="", sort="activity")
        assert result["registered"] == result["total"] == 105
        assert len(result["items"]) == 20
        assert result["items"][0]["id"] == 1
        assert result["activation_24h"] == {"eligible": 105, "completed": 2}
        assert result["guest_activity"] == {
            "hours": 168, "active_browsers": 2, "sessions": 1, "pronunciation": 1,
            "interviews": 1, "word_collections": 1, "word_reviews": 1,
        }
        assert len(queries) <= 6
        filtered = list_users(db, limit=20, offset=0, search="u105@", sort="registered")
        assert filtered["registered"] == 105
        assert filtered["total"] == 1
        assert filtered["guest_activity"] == result["guest_activity"]
        assert [user["id"] for user in filtered["items"]] == [105]
    engine.dispose()


def test_overview_counts_playback_once_and_keeps_recovery_diagnostics(client):
    owner = account(client, admin=True)
    url = "/api/admin/overview?include_experience=true"
    baseline = client.get(url, headers=owner).json()["experience"]
    complete = {"operation": "speech.complete", "duration_ms": 210, "engine": "browser"}
    payloads = [
        complete | {"outcome": "ok", "reason": "speech_error", "error_code": "network",
                    "voice_type": "enhanced", "playback_started": True},
        complete | {"outcome": "error", "reason": "startup_timeout", "playback_started": False},
        complete | {"outcome": "error"},  # Retained records predate the startup flag.
        {"operation": "chat.first_text", "duration_ms": 120, "outcome": "ok"},
        {"operation": "chat.first_text", "duration_ms": 450, "outcome": "error"},
    ]
    for body in payloads:
        assert client.post("/api/telemetry/client", json=body).status_code == 202
    assert client.post("/api/telemetry/client", json=complete | {"reason": "started", "playback_started": True}).status_code == 422
    assert client.post("/api/telemetry/client", json=payloads[3] | {"playback_started": True}).status_code == 422
    data = client.get(url, headers=owner).json()["experience"]
    for key, increment in {"completed": 1, "failed": 2, "classified": 2, "never_started": 1,
                           "recovered": 1, "recovery_failed": 1}.items():
        assert data["playback"][key] == baseline["playback"][key] + increment
    stages = {stage["operation"]: stage for stage in data["stages"]}
    old_stages = {stage["operation"]: stage for stage in baseline["stages"]}
    assert stages["chat.first_text"]["samples"] == old_stages["chat.first_text"]["samples"] + 1


def test_experience_uses_server_and_browser_releases_independently(client):
    from app.db import SessionLocal
    from app.models.telemetry import TelemetryRecord
    import secrets

    owner = account(client, admin=True)
    baseline = {s["operation"]: s["samples"] for s in client.get(
        "/api/admin/overview?include_experience=true", headers=owner).json()["experience"]["stages"]}
    releases = ("server-current-test", "server-old-test", "browser-current-test", "browser-old-test")
    now = utcnow()
    with SessionLocal() as db:
        rows = [
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="POST /api/chat/stream",
                source="server", outcome="ok", duration_ms=100, ttft_ms=111, model="deepseek-flash",
                release="server-current-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="POST /api/chat/stream",
                source="server", outcome="ok", duration_ms=100, ttft_ms=999, model="deepseek-flash",
                release="server-old-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="chat.first_text",
                source="browser", outcome="ok", duration_ms=222, release="browser-current-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="chat.first_text",
                source="browser", outcome="ok", duration_ms=999, release="browser-old-test", spans_json="[]"),
        ]
        db.add_all(rows); db.commit()
    try:
        url = ("/api/admin/overview?source=browser&release=browser-current-test&include_experience=true"
               "&experience_server_release=server-current-test&experience_browser_release=browser-current-test")
        experience = client.get(url, headers=owner).json()["experience"]
        stages = {stage["operation"]: stage for stage in experience["stages"]}
        assert stages["model.first_text"]["samples"] == 1
        assert stages["model.first_text"]["p50"] == 111
        assert stages["chat.first_text"]["samples"] == 1
        assert stages["chat.first_text"]["p50"] == 222
    finally:
        with SessionLocal() as db:
            db.query(TelemetryRecord).filter(TelemetryRecord.release.in_(releases)).delete(synchronize_session=False)
            db.commit()


def test_experience_all_sentinel_does_not_inherit_the_other_side_release(client):
    from app.db import SessionLocal
    from app.models.telemetry import TelemetryRecord
    import secrets

    owner = account(client, admin=True)
    baseline = {s["operation"]: s["samples"] for s in client.get(
        "/api/admin/overview?include_experience=true", headers=owner).json()["experience"]["stages"]}
    releases = ("server-current-test", "server-old-test", "browser-current-test", "browser-old-test")
    now = utcnow()
    with SessionLocal() as db:
        db.add_all([
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="POST /api/chat/stream",
                source="server", outcome="ok", duration_ms=100, ttft_ms=111, model="deepseek-flash",
                release="server-current-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="POST /api/chat/stream",
                source="server", outcome="ok", duration_ms=100, ttft_ms=999, model="deepseek-flash",
                release="server-old-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="chat.first_text",
                source="browser", outcome="ok", duration_ms=222, release="browser-current-test", spans_json="[]"),
            TelemetryRecord(trace_id=secrets.token_hex(16), started_at=now, operation="chat.first_text",
                source="browser", outcome="ok", duration_ms=999, release="browser-old-test", spans_json="[]"),
        ])
        db.commit()
    try:
        browser_all = ("/api/admin/overview?source=browser&release=server-current-test&include_experience=true"
                       "&experience_server_release=server-current-test&experience_browser_release=__all")
        stages = {s["operation"]: s for s in client.get(browser_all, headers=owner).json()["experience"]["stages"]}
        assert stages["model.first_text"]["samples"] == baseline["model.first_text"] + 1
        assert stages["chat.first_text"]["samples"] == baseline["chat.first_text"] + 2

        server_all = ("/api/admin/overview?source=browser&release=browser-current-test&include_experience=true"
                      "&experience_server_release=__all&experience_browser_release=browser-current-test")
        stages = {s["operation"]: s for s in client.get(server_all, headers=owner).json()["experience"]["stages"]}
        assert stages["model.first_text"]["samples"] == baseline["model.first_text"] + 2
        assert stages["chat.first_text"]["samples"] == 1
    finally:
        with SessionLocal() as db:
            db.query(TelemetryRecord).filter(TelemetryRecord.release.in_(releases)).delete(synchronize_session=False)
            db.commit()


def test_guest_visits_deduplicate_without_exposing_identity(client):
    from app.models.monitoring import SiteVisit
    reset_visits()
    owner = account(client, admin=True)
    headers = {'X-Client-Id': 'private-device-identity'}
    for _ in range(3):
        assert client.post('/api/telemetry/visit', headers=headers).status_code == 204
    data = client.get('/api/admin/overview', headers=owner).json()['visitors']
    assert data['guest_uv'] == 1 and data['registered_active'] == 0
    assert data['started_at'] is not None
    with SessionLocal() as db:
        row = db.scalar(select(SiteVisit))
        assert row.kind == 'guest' and len(row.subject_hash) == 64
        assert 'private-device' not in row.subject_hash
        assert not {'client_id', 'user_id', 'email', 'ip', 'path'} & set(SiteVisit.__table__.columns.keys())
    assert 'private-device-identity' not in str(data)


def test_concurrent_guest_reports_create_one_daily_activity(client):
    from concurrent.futures import ThreadPoolExecutor
    from app.services.monitoring import record_visit
    from app.models.monitoring import SiteVisit
    reset_visits()

    def send(_):
        with SessionLocal() as db:
            record_visit(db, 'parallel-browser')

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(send, range(12)))
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(SiteVisit)) == 1


def test_signed_token_for_missing_account_does_not_count_as_a_visitor(client):
    from app.core.security import create_token
    reset_visits()
    response = client.post('/api/telemetry/visit', headers={
        'Authorization': 'Bearer ' + create_token(999999999), 'X-Client-Id': 'browser',
    })
    assert response.status_code == 401


def test_same_account_across_devices_is_one_active_user_and_admin_is_excluded(client):
    reset_visits()
    user = account(client)
    owner = account(client, admin=True)
    for device in ('device-a', 'device-b'):
        assert client.post('/api/telemetry/visit', headers={**user, 'X-Client-Id': device}).status_code == 204
    assert client.post('/api/telemetry/visit', headers={**owner, 'X-Client-Id': 'owner-device'}).status_code == 204
    data = client.get('/api/admin/overview', headers=owner).json()['visitors']
    assert data['registered_active'] == 1 and data['guest_uv'] == 0


def test_unknown_identity_and_invalid_credentials_do_not_become_new_guests(client):
    reset_visits()
    owner = account(client, admin=True)
    assert client.post('/api/telemetry/visit').status_code == 204
    assert client.post('/api/telemetry/visit', headers={'X-Client-Id': 'anon'}).status_code == 204
    assert client.post('/api/telemetry/visit', headers={'X-Client-Id': 'u:1'}).status_code == 400
    assert client.post('/api/telemetry/visit', headers={'Authorization': 'Bearer forged', 'X-Client-Id': 'device'}).status_code == 401
    data = client.get('/api/admin/overview', headers=owner).json()['visitors']
    assert data['guest_uv'] == 0 and data['registered_active'] == 0


def test_visitor_uv_is_distinct_across_days_and_ignores_technical_filters(client):
    from app.services.monitoring import record_visit, visitor_summary
    reset_visits()
    now = utcnow()
    with SessionLocal() as db:
        record_visit(db, 'same-browser', at=now - timedelta(days=1))
        record_visit(db, 'same-browser', at=now)
        record_visit(db, 'old-only-browser', at=now - timedelta(days=2))
        assert visitor_summary(db, hours=72)['guest_uv'] == 2
        assert visitor_summary(db, hours=24)['guest_uv'] == 1
    owner = account(client, admin=True)
    for source in ('server', 'browser'):
        data = client.get('/api/admin/overview', headers=owner, params={
            'source': source, 'operation': 'does-not-exist', 'model': 'not-a-model', 'release': 'no-release', 'hours': 24,
        }).json()
        assert data['visitors']['guest_uv'] == 1


def test_disabled_visitor_collection_does_not_create_rows(client, monkeypatch):
    from app.models.monitoring import SiteVisit
    reset_visits()
    monkeypatch.setattr(get_settings(), 'telemetry_enabled', False)
    assert client.post('/api/telemetry/visit', headers={'X-Client-Id': 'disabled-device'}).status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(SiteVisit)) == 0


def test_visitor_capacity_is_separate_from_traces_and_reported_as_partial(client, monkeypatch):
    from app.services.monitoring import record_visit, visitor_summary
    from app.models.monitoring import SiteVisit
    reset_visits()
    monkeypatch.setattr(get_settings(), 'visitor_max_records', 2)
    with SessionLocal() as db:
        for i in range(3):
            record_visit(db, f'capacity-{i}')
        assert db.scalar(select(func.count()).select_from(SiteVisit)) == 2
        data = visitor_summary(db, hours=24)
        assert data['guest_uv'] == 2 and data['at_capacity'] is True


def test_idle_periodic_cleanup_preserves_learning_records(client):
    from app.models.monitoring import SiteVisit
    from app.models.telemetry import TelemetryRecord
    from app.models.practice import PracticeRecord
    from app.services.telemetry import RetentionWorker, cleanup_retained_data
    old = utcnow() - timedelta(days=30)
    tag = 'retention-' + uuid.uuid4().hex

    async def run():
        loop = asyncio.get_running_loop()
        cleaned = asyncio.Event()
        sweeps = 0

        def cleanup():
            nonlocal sweeps
            cleanup_retained_data()
            sweeps += 1
            if sweeps >= 2:
                loop.call_soon_threadsafe(cleaned.set)

        worker = RetentionWorker(interval_seconds=.02, cleanup=cleanup)
        await worker.start()
        try:
            # No request or queue submission after this point.
            with SessionLocal() as db:
                db.add(TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=old, operation=tag,
                    source='server', outcome='ok', duration_ms=1, spans_json='[]', release='qa'))
                db.add(SiteVisit(day=old.date(), kind='guest', subject_hash=uuid.uuid4().hex * 2,
                    first_seen_at=old, last_seen_at=old))
                db.add(PracticeRecord(client_id=tag, kind='interview', score=4, title=tag, created_at=old))
                db.commit()
            await asyncio.wait_for(cleaned.wait(), timeout=2)
            with SessionLocal() as db:
                assert db.scalar(select(TelemetryRecord).where(TelemetryRecord.operation == tag)) is None
                assert db.scalar(select(SiteVisit).where(SiteVisit.last_seen_at == old)) is None
                record = db.scalar(select(PracticeRecord).where(PracticeRecord.client_id == tag))
                assert record.score == 4 and record.score_max == 6
        finally:
            await worker.close()
    asyncio.run(run())
