"""The reader's settings kept in the account (every device agrees): the reading goal, and which dictionaries are
switched off and in what order."""

import json

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session


class ReadingGoal(BaseModel):
    enabled: bool = False
    minutes: int = Field(default=20, ge=1, le=600)
    days: list[int] = Field(default=[0, 1, 2, 3, 4, 5, 6])  # 0 = Monday


class DictionaryPrefs(BaseModel):
    """Which dictionaries the reader switched off, and their order per language (first = shown first)."""
    disabled: list[str] = Field(default=[], max_length=500)
    order: dict[str, list[str]] = {}


class ReaderSettings(BaseModel):
    reading_goal: ReadingGoal = ReadingGoal()
    dictionaries: DictionaryPrefs = DictionaryPrefs()


def load_settings(db: Session, email: str) -> ReaderSettings:
    raw = db.execute(text("SELECT settings FROM reader_settings WHERE reader_email = :e"), {"e": email}).scalar()
    return ReaderSettings(**(raw or {}))


def save_settings(db: Session, email: str, body: ReaderSettings) -> ReaderSettings:
    """Saves the parts sent (e.g. only the reading goal); the others stay as they are."""
    body.reading_goal.days = sorted({d for d in body.reading_goal.days if 0 <= d <= 6})
    sent = {k: v for k, v in json.loads(body.model_dump_json()).items() if k in body.model_fields_set}
    db.execute(text("""INSERT INTO reader_settings (reader_email, settings) VALUES (:e, CAST(:s AS jsonb))
                       ON CONFLICT (reader_email) DO UPDATE SET settings = reader_settings.settings || EXCLUDED.settings,
                           updated_at = now()"""),
               {"e": email, "s": json.dumps(sent)})
    db.commit()
    return load_settings(db, email)
