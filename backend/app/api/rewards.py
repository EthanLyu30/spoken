"""Daily and weekly practice rewards, redemptions, and equipment."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from app.core.deps import get_client_id
from app.data.scenarios import SCENARIOS
from app.db import get_db
from app.models.progress import LearningEvent, RewardEntry
from app.services.progress import DAILY_PRACTICE_GOAL, utcnow

router = APIRouter(prefix="/practice-rewards", tags=["practice rewards"])
CHECKIN_COINS = 5
GOAL_COINS = 15
WALLPAPER_PRICE = 20
BEIJING = timezone(timedelta(hours=8))
Item = Literal["pip-scarf", "cafe-chime", "cafe-rain"]
PRICES = {"pip-scarf": 20, "cafe-chime": 30, "cafe-rain": 80}
WeeklyGoal = Literal["practice-days", "review-expressions"]
WEEKLY_GOALS: dict[WeeklyGoal, tuple[int, int]] = {"practice-days": (3, 20), "review-expressions": (5, 15)}


class EquipmentChange(BaseModel):
    equipped: bool


def _equipment(entries: dict[str, int]) -> list[str]:
    return [item for item in PRICES if f"use:{item}" in entries and f"item:{item}" in entries]


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _utc_midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, BEIJING).astimezone(timezone.utc).replace(tzinfo=None)


def _weekly_key(goal: WeeklyGoal, starts_on: date) -> str:
    return f"week:{starts_on}:{goal}"


def _snapshot(db: Session, owner: str, day: date) -> dict:
    entries = dict(db.execute(select(RewardEntry.reward_key, RewardEntry.coins)
                              .where(RewardEntry.client_id == owner)).all())
    start = _utc_midnight(day)
    week = _week_start(day)
    week_start = _utc_midnight(week)
    occurred = LearningEvent.occurred_at
    local_day = (cast(func.timezone("Asia/Shanghai", func.timezone("UTC", occurred)), Date)
                 if db.get_bind().dialect.name == "postgresql" else func.date(occurred, "+8 hours"))
    speaking = LearningEvent.event_type.in_(("session", "practice"))
    reviewed = LearningEvent.event_type == "word_reviewed"
    inside_week = (occurred >= week_start) & (occurred < week_start + timedelta(days=7))
    expression = func.nullif(func.lower(func.trim(LearningEvent.word_text)), "")
    completed, practice_days, scenes, weekly_days, weekly_reviews = db.execute(select(
        func.count(case((speaking & (occurred >= start) & (occurred < start + timedelta(days=1)), 1))),
        func.count(case((speaking, local_day)).distinct()),
        func.count(case(((LearningEvent.event_type == "session") & LearningEvent.scenario_id.in_(
            [scene.id for scene in SCENARIOS]), LearningEvent.scenario_id)).distinct()),
        func.count(case((inside_week & speaking, local_day)).distinct()),
        func.count(case((inside_week & reviewed, expression)).distinct()),
    ).where(LearningEvent.client_id == owner, speaking | reviewed,
            occurred.is_not(None))).one()
    checked_in = f"checkin:{day}" in entries
    cursor = day if checked_in else day - timedelta(days=1)
    streak = 0
    while f"checkin:{cursor}" in entries:
        streak += 1
        cursor -= timedelta(days=1)
    weekly_counts = {"practice-days": weekly_days, "review-expressions": weekly_reviews}
    weekly = {"starts_on": str(week), "ends_on": str(week + timedelta(days=6)), "goals": [
        {"id": goal, "count": min(weekly_counts[goal], target), "target": target,
         "coins": coins, "claimed": _weekly_key(goal, week) in entries}
        for goal, (target, coins) in WEEKLY_GOALS.items()
    ]}
    return {"date": str(day), "coins": sum(entries.values()), "streak": streak, "checked_in": checked_in,
            "goal_count": completed, "goal_target": DAILY_PRACTICE_GOAL, "goal_claimed": f"goal:{day}" in entries,
            "wallpaper_unlocked": "wallpaper" in entries, "checkin_coins": CHECKIN_COINS,
            "goal_coins": GOAL_COINS, "wallpaper_price": WALLPAPER_PRICE,
            "items": [{"id": item, "price": price, "owned": f"item:{item}" in entries} for item, price in PRICES.items()],
            "equipment": _equipment(entries), "weekly": weekly,
            "achievements": [{"id": key, "count": min(count, target), "target": target, "earned": count >= target}
                             for key, count, target in (("seven-days", practice_days, 7), ("five-scenes", scenes, 5))]}


def _today() -> date:
    return utcnow().replace(tzinfo=timezone.utc).astimezone(BEIJING).date()


@router.get("")
def read(response: Response, owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    return _snapshot(db, owner, _today())


@router.get("/equipment", response_model=list[str])
def read_equipment(response: Response, owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    keys = [key for item in PRICES for key in (f"item:{item}", f"use:{item}")]
    entries = dict(db.execute(select(RewardEntry.reward_key, RewardEntry.coins).where(
        RewardEntry.client_id == owner, RewardEntry.reward_key.in_(keys))).all())
    return _equipment(entries)


def _credit(db: Session, owner: str, key: str, coins: int, day: date) -> dict:
    db.add(RewardEntry(client_id=owner, reward_key=key, coins=coins))
    db.flush()
    result = _snapshot(db, owner, day)
    db.commit()
    return result


@router.post("/weekly/{goal}")
def claim_weekly(goal: WeeklyGoal, week_start: date, response: Response,
                 owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    day = _today()
    if week_start != _week_start(day):
        raise HTTPException(409, "本周挑战已更新，请按新的进度领取。")
    state = _snapshot(db, owner, day)
    challenge = next(row for row in state["weekly"]["goals"] if row["id"] == goal)
    if challenge["claimed"]:
        return state
    if challenge["count"] < challenge["target"]:
        raise HTTPException(409, "完成本周挑战后即可领取。")
    return _credit(db, owner, _weekly_key(goal, week_start), challenge["coins"], day)


@router.post("/items/{item}")
def redeem(item: Item, response: Response, owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    day = _today()
    state = _snapshot(db, owner, day)
    key, price = f"item:{item}", PRICES[item]
    if db.get(RewardEntry, (owner, key)) is not None:
        return state
    if state["coins"] < price:
        raise HTTPException(409, "金币不足。")
    return _credit(db, owner, key, -price, day)


@router.put("/items/{item}")
def change_equipment(item: Item, payload: EquipmentChange, response: Response,
                     owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    if db.get(RewardEntry, (owner, f"item:{item}")) is None:
        raise HTTPException(409, "先兑换这份奖励，再启用。")
    key = f"use:{item}"
    row = db.get(RewardEntry, (owner, key))
    if payload.equipped and row is None:
        return _credit(db, owner, key, 0, _today())
    if not payload.equipped and row is not None:
        db.delete(row)
        db.flush()
    result = _snapshot(db, owner, _today())
    db.commit()
    return result


@router.post("/{action}")
def claim(action: Literal["checkin", "goal", "wallpaper"], response: Response,
          expected_day: date | None = None, owner: str = Depends(get_client_id), db: Session = Depends(get_db)):
    # The write dependency locks this same owner for practice and account claims.
    response.headers["Cache-Control"] = "private, no-store"
    day = _today()
    if action != "wallpaper" and expected_day is not None and expected_day != day:
        raise HTTPException(409, "已进入新的一天，请重新领取。")
    state = _snapshot(db, owner, day)
    if action == "checkin":
        key, coins, done = f"checkin:{day}", CHECKIN_COINS, state["checked_in"]
    elif action == "goal":
        key, coins, done = f"goal:{day}", GOAL_COINS, state["goal_claimed"]
        if not done and state["goal_count"] < DAILY_PRACTICE_GOAL:
            raise HTTPException(409, "完成今日练习目标后即可领取。")
    else:
        key, coins, done = "wallpaper", -WALLPAPER_PRICE, state["wallpaper_unlocked"]
        if not done and state["coins"] < WALLPAPER_PRICE:
            raise HTTPException(409, "金币不足。")
    if done:
        return state
    return _credit(db, owner, key, coins, day)
