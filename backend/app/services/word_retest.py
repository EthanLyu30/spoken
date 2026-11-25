"""One resumable assessment per owner, with idempotent, scheduled ratings."""

from uuid import uuid4

from sqlalchemy import and_, delete, func, select, true
from sqlalchemy.orm import Session

from app.models.word import WordEntry
from app.models.word_retest import WordRetest, WordRetestItem
from app.schemas.word import Word, WordSource
from app.schemas.word_retest import Rating, RetestItem, RetestRound, RetestState, StartRetest
from app.services import progress, scene_bookmarks, words


def _current(db: Session, owner: str) -> WordRetest | None:
    return db.scalar(select(WordRetest).where(WordRetest.client_id == owner))


def _matching_word(owner: str):
    return and_(WordEntry.client_id == owner, WordEntry.id == WordRetestItem.word_id,
                WordEntry.created_at == WordRetestItem.word_created_at)


def _describe(db: Session, owner: str) -> RetestRound | None:
    # Under READ COMMITTED, picking the next item in a second statement can
    # observe a rating that the counts missed. Read the whole round together.
    active = select(WordRetest.id).where(WordRetest.client_id == owner).cte("active_retest")
    members = (select(WordRetestItem.position, WordRetestItem.kind, WordRetestItem.rating,
                      WordEntry.id.label("live_word_id"))
        .select_from(WordRetestItem)
        .join(active, WordRetestItem.retest_id == active.c.id)
        .outerjoin(WordEntry, _matching_word(owner)).cte("retest_members"))
    m = members.c
    totals = select(
        func.count().filter(m.kind != "sentence").label("words"),
        func.count().filter(m.kind == "sentence").label("sentences"),
        func.count().filter(m.rating == "familiar").label("familiar"),
        func.count().filter(m.rating == "uncertain").label("uncertain"),
        func.count().filter(m.rating == "forgot").label("forgot"),
        func.count().filter(m.rating.is_(None), m.live_word_id.is_(None)).label("skipped"),
    ).subquery()
    pending = (select(m.position, m.live_word_id).where(m.rating.is_(None), m.live_word_id.is_not(None))
               .order_by(m.position).limit(1).subquery())
    row = db.execute(select(active.c.id, *totals.c, pending.c.position, WordEntry)
        .select_from(active).join(totals, true()).outerjoin(pending, true())
        .outerjoin(WordEntry, WordEntry.id == pending.c.live_word_id)
        .execution_options(populate_existing=True)).one_or_none()
    if row is None:
        return None
    retest_id, word_count, sentence_count, familiar, uncertain, forgot, skipped, position, word = row
    return RetestRound(id=retest_id, words=word_count, sentences=sentence_count, familiar=familiar,
        uncertain=uncertain, forgot=forgot, skipped=skipped,
        next_item=RetestItem(position=position, word=Word.model_validate(word)) if word is not None else None)


def _unadded(db: Session, owner: str, entries: list[WordEntry]):
    existing = {scene_bookmarks.sentence_key(entry.text) for entry in entries}
    for scene, cues in scene_bookmarks.saved_sentences(db, owner):
        for cue in cues:
            key = scene_bookmarks.sentence_key(cue.sentence)
            if key not in existing:
                existing.add(key)
                yield scene, cue


def read(db: Session, owner: str) -> RetestState:
    entries = words.list_words(db, owner)
    sentences = sum(entry.kind == "sentence" for entry in entries)
    return RetestState(words=len(entries) - sentences, sentences=sentences,
        unadded_scene=sum(1 for _ in _unadded(db, owner, entries)), round=_describe(db, owner))


def discard(db: Session, retest_id: str) -> None:
    db.execute(delete(WordRetestItem).where(WordRetestItem.retest_id == retest_id))
    db.execute(delete(WordRetest).where(WordRetest.id == retest_id))


def begin(db: Session, owner: str, payload: StartRetest, timezone: str) -> RetestRound:
    progress.lock_owner(db, owner)
    previous = _describe(db, owner)
    if previous is not None and (previous.next_item or payload.replace_id != previous.id):
        db.commit()
        return previous
    entries = words.list_words(db, owner)
    if payload.include_scene:
        for scene, cue in _unadded(db, owner, entries):
            custom = scene.scene_key.startswith("custom-")
            source = WordSource(key=scene.scene_key, title=scene.title) if custom else None
            entry = WordEntry(client_id=owner, text=cue.sentence, meaning=cue.meaning, example=cue.sentence,
                kind="sentence", scenario_id="custom" if custom else scene.scene_key, topic=scene.title[:48],
                source=source.model_dump() if source else None)
            words.record_collection(db, entry)
            entries.append(entry)
        progress.stats_and_awards(db, owner, timezone)
    if not entries:
        raise ValueError("还没有可以重测的收藏。")
    if previous is not None:
        discard(db, previous.id)
    retest = WordRetest(id=str(uuid4()), client_id=owner)
    db.add(retest)
    db.flush()
    for position, entry in enumerate(sorted(entries, key=lambda row: (row.kind == "sentence", row.id))):
        db.add(WordRetestItem(retest_id=retest.id, position=position, word_id=entry.id,
                             word_created_at=entry.created_at, kind=entry.kind))
    db.flush()
    result = _describe(db, owner)
    assert result is not None
    db.commit()
    return result


def rate(db: Session, owner: str, retest_id: str, position: int, rating: Rating, timezone: str) -> RetestRound:
    progress.lock_owner(db, owner)
    retest = _current(db, owner)
    item = db.get(WordRetestItem, (retest_id, position)) if retest and retest.id == retest_id else None
    if item is None:
        raise LookupError("没找到这条重测记录。")
    if item.rating is not None and item.rating != rating:
        raise ValueError("这条表达已在另一处定级，请刷新后继续。")
    if item.rating is None:
        entry = words.get_word(db, owner, item.word_id)
        if entry is not None and entry.created_at == item.word_created_at:
            item.rating = rating
            if rating != "familiar":
                entry.mastered = False
            words.apply_locked_review(db, entry, rating == "familiar", timezone,
                                      uncertain=rating == "uncertain", commit=False)
    result = _describe(db, owner)
    assert result is not None
    db.commit()
    return result


def claim(db: Session, device: str, owner: str) -> None:
    guest = _current(db, device)
    if guest is not None:
        if _current(db, owner) is None:
            guest.client_id = owner
        else:
            discard(db, guest.id)
