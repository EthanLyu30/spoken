"""Idempotency inside the caller's owner-locked activity transaction."""

import hashlib
import json
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.practice import PracticeRecord
from app.models.progress import LearningEvent
from app.models.request_receipt import RequestReceipt


class RequestConflict(Exception):
    """A stable operation key was reused with different input."""


def payload_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False).encode("utf-8")).hexdigest()


def find(db: Session, owner: str, operation: str, key: str | None,
         fingerprint: str) -> RequestReceipt | None:
    if key is None:
        return None
    receipt = db.get(RequestReceipt, (owner, operation, key))
    if receipt is not None and receipt.payload_hash != fingerprint:
        raise RequestConflict("client_request_id was already used with different input")
    return receipt


def remember(db: Session, owner: str, operation: str, key: str | None,
             fingerprint: str, event: LearningEvent, metadata: dict) -> None:
    if key is not None:
        db.add(RequestReceipt(client_id=owner, operation=operation, client_request_id=key,
            payload_hash=fingerprint, source_id=event.source_id, event_key=event.event_key,
            response_metadata=json.dumps(metadata)))


def claim(db: Session, device_id: str, owner_id: str) -> None:
    """Account receipts win collisions; preserve badge union in progress.claim.

    Delete by event identity, never by a recyclable source ID alone. Pruned
    practice IDs may have been reused by unrelated newer source records.
    """
    account_keys = set(db.execute(select(RequestReceipt.operation, RequestReceipt.client_request_id)
        .where(RequestReceipt.client_id == owner_id)).tuples())
    for receipt in db.scalars(select(RequestReceipt).where(RequestReceipt.client_id == device_id)):
        if (receipt.operation, receipt.client_request_id) not in account_keys:
            continue
        if receipt.operation == "practice":
            metadata = json.loads(receipt.response_metadata)
            db.execute(delete(PracticeRecord).where(PracticeRecord.client_id == device_id,
                PracticeRecord.id == receipt.source_id,
                PracticeRecord.created_at == datetime.fromisoformat(metadata["created_at"])))
        db.execute(delete(LearningEvent).where(LearningEvent.client_id == device_id,
                                               LearningEvent.event_key == receipt.event_key))
        db.delete(receipt)
    db.flush()
    db.execute(update(RequestReceipt).where(RequestReceipt.client_id == device_id).values(client_id=owner_id))
