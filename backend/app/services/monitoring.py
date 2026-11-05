"""Anonymous browser/account UV, with server-side de-duplication and bounds."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import String, case, cast, delete, literal, select, func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import get_settings
from app.models.monitoring import MonitoringState, SiteVisit
from app.models.practice import PracticeRecord
from app.models.progress import LearningEvent
from app.models.session import PracticeSession
from app.models.telemetry import AdminAccount
from app.models.user import User
from app.models.word import WordEntry


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


def registered_users(db, *, limit, offset, search, sort):
    now = utcnow()
    week_ago = now - timedelta(days=7)
    day = timedelta(hours=24)
    ordinary = ~select(AdminAccount.user_id).where(AdminAccount.user_id == User.id).exists()
    owner = literal("u:") + cast(User.id, String)
    # Count only accounts with a full observation window. Guest history
    # claimed at registration can predate the account and cannot activate it.
    eligible = User.created_at.between(week_ago, now - day)
    if db.get_bind().dialect.name == "sqlite":
        # SQLite stores these timestamps as ISO text. Advance the UTC date
        # without dropping fractional seconds from the time.
        window_end = cast(func.date(User.created_at, "+1 day"), String) + func.substr(User.created_at, 11)
    else:
        window_end = User.created_at + day
    completed = select(LearningEvent.event_key).where(
        LearningEvent.client_id == owner,
        LearningEvent.event_type.in_(("session", "practice")),
        LearningEvent.occurred_at.between(User.created_at, window_end),
    ).correlate(User).exists()
    registered, new, mature, activated = db.execute(select(
        func.count(User.id),
        func.count(case((User.created_at >= week_ago, 1))),
        func.count(case((eligible, 1))),
        func.count(case((eligible, case((completed, 1))))),
    ).where(ordinary)).one()

    matched = [ordinary]
    if search:
        matched.append(User.email.icontains(search, autoescape=True) | User.display_name.icontains(search, autoescape=True))
    total = db.scalar(select(func.count(User.id)).where(*matched)) if search else registered
    latest = select(func.max(LearningEvent.occurred_at)).where(
        LearningEvent.client_id == owner, LearningEvent.event_type.in_(("session", "practice", "word_reviewed")),
    ).correlate(User).scalar_subquery().label("last_active")
    order = [User.created_at.desc(), User.id.desc()]
    if sort == "activity":
        order.insert(0, latest.desc().nulls_last())
    page = select(User.id, User.email, User.display_name, User.created_at, latest, owner.label("owner")) \
        .where(*matched).order_by(*order).limit(limit).offset(offset).subquery()

    def count_for(model):
        return select(func.count()).select_from(model).where(model.client_id == page.c.owner).correlate(page).scalar_subquery()

    page_order = [page.c.created_at.desc(), page.c.id.desc()]
    if sort == "activity":
        page_order.insert(0, page.c.last_active.desc().nulls_last())
    rows = db.execute(select(page.c.id, page.c.email, page.c.display_name, page.c.created_at, page.c.last_active,
        count_for(PracticeSession).label("sessions"), count_for(WordEntry).label("words"),
        count_for(PracticeRecord).label("practice")).order_by(*page_order)).mappings()
    items = [dict(row) | {
        "created_at": row["created_at"].isoformat() + "Z",
        "last_active": row["last_active"].isoformat() + "Z" if row["last_active"] else None,
    } for row in rows]
    return {
        "items": items, "registered": registered, "total": total, "limit": limit, "new_7d": new,
        "activation_24h": {"eligible": mature, "completed": activated},
        "visitors": visitor_summary(db, hours=168),
        "note": "访客数据按设备隔离且只保留哈希计数，无法反查具体身份。",
    }
