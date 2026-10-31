"""Anonymous browser/account UV, with server-side de-duplication and bounds."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, delete, select, func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import get_settings
from app.models.monitoring import MonitoringState, SiteVisit
from app.models.telemetry import AdminAccount
from app.models.user import User


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _insert(db, model):
    return (sqlite_insert if db.get_bind().dialect.name == 'sqlite' else pg_insert)(model)


def state_time(db, key):
    value = db.scalar(select(MonitoringState.at).where(MonitoringState.key == key))
    return value.isoformat(timespec='seconds') + 'Z' if value else None


def mark_state(db, key, at, *, first=False):
    query = _insert(db, MonitoringState).values(key=key, at=at)
    query = query.on_conflict_do_nothing(index_elements=['key']) if first else query.on_conflict_do_update(
        index_elements=['key'], set_={'at': at})
    db.execute(query)


def initialize_visitors(db, now):
    settings = get_settings()
    if settings.telemetry_enabled and settings.jwt_secret:
        mark_state(db, 'visitor_started', now, first=True)


def prune_visits(db, now):
    settings = get_settings()
    db.execute(delete(SiteVisit).where(SiteVisit.last_seen_at < now - timedelta(days=settings.telemetry_retention_days)))
    overflow = select(SiteVisit.id).order_by(SiteVisit.last_seen_at.desc(), SiteVisit.id.desc()).offset(settings.visitor_max_records)
    db.execute(delete(SiteVisit).where(SiteVisit.id.in_(overflow)))


def record_visit(db, client_id, *, at=None):
    settings = get_settings()
    if not settings.telemetry_enabled or not settings.jwt_secret or not client_id or client_id == 'anon':
        return
    if client_id.startswith('u:'):
        uid = int(client_id[2:])
        if db.get(User, uid) is None:
            raise HTTPException(status_code=401, detail='未登录或登录已过期')
        if db.get(AdminAccount, uid) is not None:
            return
        kind = 'registered'
    else:
        kind = 'guest'
    now = at or utcnow()
    digest = hmac.new(settings.jwt_secret.encode(), f'spoken-visitors-v1/{kind}/{client_id}'.encode(), hashlib.sha256).hexdigest()
    initialize_visitors(db, now)
    query = _insert(db, SiteVisit).values(day=now.date(), kind=kind, subject_hash=digest,
        first_seen_at=now, last_seen_at=now)
    db.execute(query.on_conflict_do_update(index_elements=['day', 'kind', 'subject_hash'],
        set_={'last_seen_at': case((SiteVisit.last_seen_at < query.excluded.last_seen_at,
            query.excluded.last_seen_at), else_=SiteVisit.last_seen_at),
            'first_seen_at': case((SiteVisit.first_seen_at > query.excluded.first_seen_at,
            query.excluded.first_seen_at), else_=SiteVisit.first_seen_at)}))
    prune_visits(db, now)
    db.commit()


def visitor_summary(db, *, hours=24):
    settings = get_settings()
    cutoff = utcnow() - timedelta(hours=hours)
    counts = dict(db.execute(select(SiteVisit.kind, func.count(func.distinct(SiteVisit.subject_hash)))
        .where(SiteVisit.last_seen_at >= cutoff).group_by(SiteVisit.kind)).all())
    retained = db.scalar(select(func.count()).select_from(SiteVisit))
    started = state_time(db, 'visitor_started')
    return {'guest_uv': counts.get('guest', 0) if started else None,
        'registered_active': counts.get('registered', 0) if started else None,
        'enabled': bool(settings.telemetry_enabled and settings.jwt_secret), 'started_at': started,
        'hours': hours, 'max_records': settings.visitor_max_records,
        'at_capacity': retained >= settings.visitor_max_records}
