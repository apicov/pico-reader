"""Reading statistics and the reader's AI use (app/stats_service.py)."""

from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import stats_service
from app.auth import Reader, get_current_reader
from app.db import get_db
from app.errors import Invalid
from app.settings_service import ReadingGoal

router = APIRouter(prefix="/api", tags=["stats"])


class Bucket(BaseModel):
    start: date
    seconds: int
    words: int
    lookups: int


class Totals(BaseModel):
    seconds: int
    words: int
    lookups: int


class Streak(BaseModel):
    current: int
    best: int


class GoalProgress(ReadingGoal):
    days_met: int
    days_due: int


class BookStats(BaseModel):
    book_id: str
    title: str
    language: str
    word_count: int | None
    seconds: int
    words: int
    sessions: int
    last_read: datetime
    progress: float
    wpm: int | None  # words a minute
    minutes_left: int | None


class DensityPoint(BaseModel):
    start: date
    value: float | None  # None: too few words read that day or week


class Density(BaseModel):
    """Lookups per 1000 words read, in one language."""
    series: list[DensityPoint]
    words: int
    lookups: int
    per_1000: float | None


class RepeatedWord(BaseModel):
    word: str
    language: str
    times: int
    last: datetime


class NotFoundWord(BaseModel):
    word: str
    language: str
    times: int


class TranslationCount(BaseModel):
    start: date
    count: int
    avg_chars: float


class Stats(BaseModel):
    review_due: int
    known_words: int
    period: str
    bucket: str  # day | week
    today: date
    buckets: list[Bucket]
    totals: Totals
    today_seconds: int
    streak: Streak
    goal: GoalProgress | None
    books: list[BookStats]
    heatmap: list[list[int]]  # [weekday, 0 = Monday][hour]: seconds
    density: dict[str, Density]  # per language
    repeated: list[RepeatedWord]
    not_found: list[NotFoundWord]
    translations: list[TranslationCount]


class PurposeUsage(BaseModel):
    purpose: str
    calls: int
    prompt_tokens: int
    completion_tokens: int


class DayUsage(BaseModel):
    day: date
    tokens: int
    calls: int


class Usage(BaseModel):
    period: str
    calls: int
    prompt_tokens: int
    completion_tokens: int
    tokens: int
    by_purpose: list[PurposeUsage]
    by_day: list[DayUsage]


@router.get("/stats", response_model=Stats)
def stats(period: str = "week", tz: str = "UTC", book_id: str | None = None,
          reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return stats_service.reading_stats(db, reader.email, period, tz, book_id)


@router.get("/usage", response_model=Usage)
def usage(period: str = "month", tz: str = "UTC", reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The reader's own AI use: tokens per purpose and per day."""
    if period not in (*stats_service.PERIODS, "all"):
        raise Invalid("period is week, month, year or all")
    return stats_service.usage_summary(db, reader.email, period, tz)
