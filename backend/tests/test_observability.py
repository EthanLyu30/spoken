import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import SessionLocal


def test_root_failure_collects_class_names_without_exception_messages():
    from app.core.observability import TraceContext, trace_error

    try:
        with TraceContext('GET /api/practice') as trace:
            try:
                raise ConnectionError('private connection string and password')
            except ConnectionError as cause:
                raise RuntimeError('private answer and SQL parameters') from cause
    except RuntimeError:
        pass
    record = trace.record()
    assert record['error_type'] == 'RuntimeError'
    assert record['error_cause_type'] == 'ConnectionError'
    assert 'private' not in json.dumps(record, default=str)
    assert json.loads(record['spans_json']) == []

    with TraceContext('POST /api/chat/stream') as caught:
        trace_error(TimeoutError('private upstream response'))
    assert caught.record()['error_type'] == 'TimeoutError'
    assert caught.record()['outcome'] == 'timeout'


def test_old_and_new_failure_details_preserve_unknowns():
    from app.models.telemetry import TelemetryRecord
    from app.services.telemetry import serialize

    for error_type in (None, 'OperationalError'):
        record = TelemetryRecord(trace_id='f' * 32, operation='GET /api/practice',
            started_at=datetime.now(timezone.utc).replace(tzinfo=None), source='server',
            outcome='error', duration_ms=6, spans_json='[]', release='qa',
            error_type=error_type, error_cause_type='AdminShutdown' if error_type else None)
        result = serialize(record, detail=True)
        assert result['error_type'] == error_type
        assert result['error_cause_type'] == ('AdminShutdown' if error_type else None)
        assert result['http_status'] is None
        assert result['spans'] == []


def account(client, *, admin=False):
    email = f"qa-{uuid.uuid4().hex}@example.com"
    response = client.post('/api/auth/register', json={
        'email': email, 'password': 'qa-private-dashboard', 'is_admin': True,
    })
    assert response.status_code == 201
    data = response.json()
    if admin:
        from app.models.telemetry import AdminAccount
        with SessionLocal() as db:
            db.add(AdminAccount(user_id=data['user']['id']))
            db.commit()
    return {'Authorization': f"Bearer {data['token']}"}


@pytest.mark.parametrize('path', ['/api/admin/overview', '/api/admin/traces', '/api/admin/traces/' + '0' * 32])
def test_private_monitoring_requires_login(path):
    with TestClient(app) as client:
        assert client.get(path).status_code == 401
        assert client.get(path, headers={'Authorization': 'Bearer forged'}).status_code == 401
        assert client.get(path, headers={'X-Client-Id': 'u:1'}).status_code == 401


def test_only_explicitly_granted_account_can_read_or_discover_admin():
    with TestClient(app) as client:
        ordinary = account(client)
        assert client.get('/api/auth/me', headers=ordinary).json().get('is_admin') is False
        assert client.get('/api/admin/overview', headers=ordinary).status_code == 403
        client.patch('/api/auth/me', headers=ordinary, json={'is_admin': True})
        assert client.get('/api/admin/traces', headers=ordinary).status_code == 403
        assert client.get('/api/admin/traces/' + '0' * 32, headers=ordinary).status_code == 403
        owner = account(client, admin=True)
        assert client.get('/api/auth/me', headers=owner).json()['is_admin'] is True
        assert client.get('/api/admin/overview', headers=owner).status_code == 200
        assert client.get('/api/admin/traces/' + '0' * 32, headers=owner).status_code == 404


def test_percentiles_unknown_usage_and_cancelled_denominator_are_not_faked():
    from app.models.telemetry import TelemetryRecord
    tag = 'qa.' + uuid.uuid4().hex
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with TestClient(app) as client:
        owner = account(client, admin=True)
        with SessionLocal() as db:
            for duration, outcome, tokens in [(10, 'ok', 0), (20, 'ok', 30), (1000, 'error', None), (40, 'cancelled', None)]:
                db.add(TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=now, operation=tag,
                    source='server', outcome=outcome, duration_ms=duration, http_status=200,
                    input_tokens=tokens, output_tokens=tokens, spans_json='[]', release='qa'))
            db.add(TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=now-timedelta(days=3), operation=tag,
                source='server', outcome='ok', duration_ms=9999, http_status=200, spans_json='[]', release='qa'))
            db.add(TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=now, operation=tag+'.other',
                source='server', outcome='ok', duration_ms=500, http_status=200, spans_json='[]', release='qa'))
            db.commit()
        data = client.get('/api/admin/overview', headers=owner, params={'operation': tag, 'hours': 24}).json()
        assert data['count'] == 4
        assert data['success_rate'] == pytest.approx(2 / 3)
        assert data['cancelled'] == 1
        assert data['latency'] == {'p50': 20.0, 'p95': 1000.0, 'p99': 1000.0}
        assert data['input_tokens'] == 30 and data['usage_known'] == 2
        assert data['ttft']['p95'] is None
        assert tag+'.other' in data['facets']['operations']
        empty = client.get('/api/admin/overview', headers=owner, params={'operation': 'qa.empty'}).json()
        assert empty['count'] == 0 and empty['success_rate'] is None
        assert empty['latency']['p95'] is None


def test_business_request_captured_with_route_template_and_without_content():
    with TestClient(app) as client:
        owner = account(client, admin=True)
        secret = 'never-store-question-text-or-api-key'
        response = client.get('/api/practice/99999999', headers=owner, params={'secret': secret})
        assert response.status_code == 404
        trace_id = response.headers['x-trace-id']
        detail = client.get('/api/admin/traces/' + trace_id, headers=owner)
        assert detail.status_code == 200
        data = detail.json()
        assert data['operation'] == 'GET /api/practice/{record_id}'
        assert data['outcome'] == 'error'
        assert secret not in json.dumps(data)
        assert 'Authorization' not in json.dumps(data)


def test_browser_samples_have_separate_source_and_reject_extra_content():
    with TestClient(app) as client:
        owner = account(client, admin=True)
        assert client.post('/api/telemetry/client', json={'operation': 'asr.finalize', 'duration_ms': 920, 'engine': 'xfyun'}).status_code == 202
        assert client.post('/api/telemetry/client', json={'operation': 'asr.finalize', 'duration_ms': -1}).status_code == 422
        assert client.post('/api/telemetry/client', json={'operation': 'asr.finalize', 'duration_ms': True}).status_code == 422
        assert client.post('/api/telemetry/client', json={'operation': 'asr.finalize', 'duration_ms': 1, 'text': 'private transcript'}).status_code == 422
        assert client.post('/api/telemetry/client', content=b'x' * 4097).status_code == 413
        assert client.post('/api/telemetry/client', content='{"operation":"asr.finalize","duration_ms":1e999}').status_code == 422
        data = client.get('/api/admin/overview', headers=owner, params={'operation': 'asr.finalize', 'source': 'browser'}).json()
        assert data['source'] == 'browser' and data['count'] >= 1
        assert data['input_tokens'] is None


def test_parallel_contexts_do_not_share_spans_or_private_attributes():
    from app.core.observability import TraceContext, span
    async def run():
        async def one(name):
            with TraceContext(operation=name) as trace:
                with span(name, provider='qa', prompt='secret', api_key='secret'):
                    await asyncio.sleep(0)
                return trace.record()
        return await asyncio.gather(one('first'), one('second'))
    first, second = asyncio.run(run())
    assert first['trace_id'] != second['trace_id']
    assert [s['name'] for s in json.loads(first['spans_json'])] == ['first']
    assert [s['name'] for s in json.loads(second['spans_json'])] == ['second']
    assert 'secret' not in first['spans_json']


def test_retention_only_removes_telemetry():
    from app.services.telemetry import persist_batch
    from app.models.telemetry import TelemetryRecord
    from app.models.user import User
    from sqlalchemy import select, func
    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(User))
        stale = TelemetryRecord(trace_id=uuid.uuid4().hex, started_at=datetime.now(timezone.utc).replace(tzinfo=None)-timedelta(days=20),
            operation='qa.stale', source='server', outcome='ok', duration_ms=10, spans_json='[]', release='qa')
        db.add(stale); db.commit(); stale_id = stale.trace_id
    persist_batch([])
    with SessionLocal() as db:
        assert db.scalar(select(TelemetryRecord).where(TelemetryRecord.trace_id == stale_id)) is None
        assert db.scalar(select(func.count()).select_from(User)) == before


def test_failed_telemetry_write_does_not_fail_business_request(monkeypatch):
    import app.services.telemetry as telemetry
    def unavailable(_):
        raise OSError('private connection string must not be logged')
    monkeypatch.setattr(telemetry, 'persist_batch', unavailable)
    with TestClient(app) as client:
        owner = account(client, admin=True)
        response = client.get('/api/interview/questions', params={'set_id': 'inspire-writing-190'})
        assert response.status_code == 200 and len(response.json()['questions']) == 4
        result = client.get('/api/admin/overview', headers=owner)
        assert result.status_code == 200
        assert result.headers['cache-control'] == 'no-store'
        assert result.json()['collection']['write_errors_since_restart'] >= 1


def test_shutdown_sentinel_is_not_written_as_a_record(monkeypatch):
    import app.services.telemetry as telemetry
    captured = []
    def store(rows):
        assert all(isinstance(row, dict) for row in rows)
        captured.extend(rows)
    monkeypatch.setattr(telemetry, 'persist_batch', store)
    async def run():
        sink = telemetry.TelemetrySink(capacity=2)
        # Simulate shutdown reaching its flush budget with a batch still queued.
        async def flush_budget_expired():
            return None
        monkeypatch.setattr(sink, 'flush', flush_budget_expired)
        sink.submit({'trace_id': 'queued'})
        await asyncio.wait_for(sink.close(), timeout=0.3)
    asyncio.run(run())
    assert captured == [{'trace_id': 'queued'}]


def test_grant_resolves_existing_account_and_never_creates_one():
    from app.services.telemetry import grant_admin
    from app.models.user import User
    from sqlalchemy import select, func
    with TestClient(app) as client:
        headers = account(client)
        user = client.get('/api/auth/me', headers=headers).json()
        with SessionLocal() as db:
            count = db.scalar(select(func.count()).select_from(User))
            with pytest.raises(ValueError):
                grant_admin(db, 'missing-' + uuid.uuid4().hex + '@example.com')
            assert db.scalar(select(func.count()).select_from(User)) == count
            assert grant_admin(db, user['email'].upper()) == user['id']
            assert grant_admin(db, user['email']) == user['id']
        assert client.get('/api/admin/overview', headers=headers).status_code == 200


def test_untrusted_browser_volume_cannot_evict_trusted_server_history(monkeypatch):
    from app.core.config import get_settings
    from app.models.telemetry import TelemetryRecord
    from app.services.telemetry import persist_batch
    from sqlalchemy import select
    monkeypatch.setattr(get_settings(), 'telemetry_max_records', 100)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    server_id = uuid.uuid4().hex
    with SessionLocal() as db:
        db.add(TelemetryRecord(trace_id=server_id, started_at=now, operation='qa.protect-server', source='server',
            outcome='ok', duration_ms=1, spans_json='[]', release='qa'))
        db.commit()
    persist_batch([{'trace_id': uuid.uuid4().hex, 'started_at': now, 'operation': 'asr.finalize', 'source': 'browser',
        'outcome': 'ok', 'duration_ms': 1, 'spans_json': '[]', 'release': 'browser'} for _ in range(110)])
    with SessionLocal() as db:
        assert db.scalar(select(TelemetryRecord).where(TelemetryRecord.trace_id == server_id)) is not None


def test_correlates_a_voice_turn_without_merging_browser_and_server_clocks():
    interaction = uuid.uuid4().hex
    with TestClient(app) as client:
        owner = account(client, admin=True)
        first = client.get('/api/interview/questions', headers={'X-Interaction-Id': interaction})
        second = client.get('/api/interview/questions', headers={'X-Interaction-Id': interaction})
        assert client.post('/api/telemetry/client', json={'operation': 'voice.complete', 'duration_ms': 1800,
            'interaction_id': interaction}).status_code == 202
        data = client.get('/api/admin/traces/' + first.headers['x-trace-id'], headers=owner).json()
        assert data['interaction_id'] == interaction
        assert len(data['related']) == 2
        assert {r['source'] for r in data['related']} == {'server', 'browser'}
        assert second.headers['x-trace-id'] in {r['trace_id'] for r in data['related']}


def test_admin_cli_database_errors_do_not_print_private_inputs(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path
    path = tmp_path / 'admin-cli-empty.db'
    private_email = 'private-admin-email@example.com'
    try:
        result = subprocess.run([sys.executable, 'scripts/admin_user.py', '--email', private_email],
            cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
            env={**os.environ, 'DATABASE_URL': 'sqlite:///' + path.as_posix()})
        assert result.returncode != 0
        assert private_email not in result.stderr + result.stdout
        assert 'Traceback' not in result.stderr
    finally:
        path.unlink(missing_ok=True)


def test_bootstrap_binds_only_an_existing_account_once():
    from app.services.telemetry import bootstrap_admin, is_admin
    from app.models.telemetry import AdminAccount
    with TestClient(app) as client:
        headers = account(client)
        user = client.get('/api/auth/me', headers=headers).json()
        with SessionLocal() as db:
            assert bootstrap_admin(db, user['email']) == user['id']
            db.delete(db.get(AdminAccount, user['id'])); db.commit()
            assert bootstrap_admin(db, user['email']) is None
            assert not is_admin(db, user['id'])
        assert client.get('/api/admin/overview', headers=headers).status_code == 403


def test_bootstrap_cannot_grant_a_future_registration():
    from app.services.telemetry import bootstrap_admin, is_admin
    email = 'bootstrap-missing-' + uuid.uuid4().hex + '@example.com'
    with SessionLocal() as db:
        assert bootstrap_admin(db, email) is None
    with TestClient(app) as client:
        created = client.post('/api/auth/register', json={'email': email, 'password': 'qa-password'}).json()
        with SessionLocal() as db:
            assert bootstrap_admin(db, email) is None
            assert not is_admin(db, created['user']['id'])


def test_startup_bootstrap_authorizes_configured_existing_owner(monkeypatch):
    from app.core.config import get_settings
    with TestClient(app) as client:
        headers = account(client)
        email = client.get('/api/auth/me', headers=headers).json()['email']
    monkeypatch.setattr(get_settings(), 'admin_bootstrap_email', email, raising=False)
    with TestClient(app) as client:
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is True


def test_operator_can_start_a_new_binding_attempt_after_a_late_registration(monkeypatch):
    from types import SimpleNamespace
    from app.core.config import get_settings
    from app.models.telemetry import AdminAccount
    from app.services import telemetry
    email = 'late-owner-' + uuid.uuid4().hex + '@example.com'
    with SessionLocal() as db:
        assert telemetry.bootstrap_admin(db, email) is None
    with TestClient(app) as client:
        registered = client.post('/api/auth/register', json={'email': email, 'password': 'qa-password'}).json()
        headers = {'Authorization': 'Bearer ' + registered['token']}
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is False
    settings = SimpleNamespace(**{**get_settings().model_dump(), 'admin_bootstrap_email': email,
        'admin_bootstrap_attempt': 'explicit-operator-retry'})
    monkeypatch.setattr(telemetry, 'get_settings', lambda: settings)
    with TestClient(app) as client:
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is True
        assert client.get('/api/admin/overview', headers=headers).status_code == 200
    with SessionLocal() as db:
        db.delete(db.get(AdminAccount, registered['user']['id'])); db.commit()
    with TestClient(app) as client:
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is False
        assert client.get('/api/admin/overview', headers=headers).status_code == 403


def test_missing_account_consumes_the_explicit_attempt_until_operator_changes_it(monkeypatch):
    from types import SimpleNamespace
    from app.core.config import get_settings
    from app.services import telemetry
    email = 'late-explicit-' + uuid.uuid4().hex + '@example.com'
    settings = SimpleNamespace(**{**get_settings().model_dump(), 'admin_bootstrap_email': email,
        'admin_bootstrap_attempt': 'first-attempt'})
    monkeypatch.setattr(telemetry, 'get_settings', lambda: settings)
    with TestClient(app) as client:
        registered = client.post('/api/auth/register', json={'email': email, 'password': 'qa-password'}).json()
        headers = {'Authorization': 'Bearer ' + registered['token']}
        assert registered['user']['is_admin'] is False
    with TestClient(app) as client:
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is False
    settings.admin_bootstrap_attempt = 'second-explicit-attempt'
    with TestClient(app) as client:
        assert client.get('/api/auth/me', headers=headers).json()['is_admin'] is True
