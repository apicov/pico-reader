"""Reading statistics and the reading goal.

Days are the reader's own days: the app sends its time zone, and every day boundary is computed in it."""


from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["stats"])

STREAK_SECONDS = 60  # a day with at least a minute of reading keeps the streak


# --- settings (the reading goal) ---

class ReadingGoal(BaseModel):
    enabled: bool = False
    minutes: int = Field(default=20, ge=1, le=600)
    days: list[int] = Field(default=[0, 1, 2, 3, 4, 5, 6])  # 0 = Monday


class ReaderSettings(BaseModel):
    reading_goal: ReadingGoal = ReadingGoal()


def load_settings(db: Session, email: str) -> ReaderSettings:
    raw = db.execute(text("SELECT settings FROM reader_settings WHERE reader_email = :e"), {"e": email}).scalar()
    return ReaderSettings(**(raw or {}))


@router.get("/settings", response_model=ReaderSettings)
def get_settings_(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return load_settings(db, reader.email)


@router.put("/settings", response_model=ReaderSettings)
def put_settings(body: ReaderSettings, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    body.reading_goal.days = sorted({d for d in body.reading_goal.days if 0 <= d <= 6})
    db.execute(text("""INSERT INTO reader_settings (reader_email, settings) VALUES (:e, CAST(:s AS jsonb))
                       ON CONFLICT (reader_email) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()"""),
               {"e": reader.email, "s": body.model_dump_json()})
    db.commit()
    return body


# --- statistics ---

PERIODS = {"week": 7, "month": 30, "year": 365}


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Unknown time zone")


def _streaks(days_read: set[date], today: date) -> tuple[int, int]:
    """(current, best). Today not read yet doesn't break the current streak."""
    best = run = 0
    previous = None
    for d in sorted(days_read):
        run = run + 1 if previous and d - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = d
    current = 0
    d = today if today in days_read else today - timedelta(days=1)
    while d in days_read:
        current += 1
        d -= timedelta(days=1)
    return current, best


@router.get("/stats")
def stats(period: str = "week", tz: str = "UTC", book_id: str | None = None,
          reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    zone = _zone(tz)
    now = datetime.now(timezone.utc)
    today = now.astimezone(zone).date()
    if period in PERIODS:
        first_day = today - timedelta(days=PERIODS[period] - 1)
    elif period == "all":
        first = db.execute(text("SELECT min(started_at) FROM reading_sessions WHERE reader_email = :e"),
                           {"e": reader.email}).scalar()
        first_day = first.astimezone(zone).date() if first else today
    else:
        raise HTTPException(422, "period is week, month, year or all")
    weekly = (today - first_day).days > 62
    if weekly:
        first_day -= timedelta(days=first_day.weekday())  # buckets start on Mondays
    since = datetime.combine(first_day, datetime.min.time(), zone)
    p = {"e": reader.email, "tz": tz, "since": since, "book": book_id}
    book_filter = "AND s.book_id = :book" if book_id else ""
    lookup_filter = "AND l.book_id = :book" if book_id else ""

    # every day of the period, then bucketed
    per_day = {r.day: r for r in db.execute(text(f"""
        SELECT (s.started_at AT TIME ZONE :tz)::date AS day, sum(s.seconds) AS seconds, sum(s.words) AS words
        FROM reading_sessions s WHERE s.reader_email = :e AND s.started_at >= :since {book_filter}
        GROUP BY 1"""), p)}
    lookups_per_day = {r.day: r.n for r in db.execute(text(f"""
        SELECT (l.created_at AT TIME ZONE :tz)::date AS day, count(*) AS n
        FROM lookups l WHERE l.reader_email = :e AND l.created_at >= :since {lookup_filter} GROUP BY 1"""), p)}
    settings = load_settings(db, reader.email)
    goal = settings.reading_goal
    buckets: dict[date, dict] = {}
    goal_days = goal_met = 0
    d = first_day
    while d <= today:
        start = d - timedelta(days=d.weekday()) if weekly else d
        b = buckets.setdefault(start, {"start": start.isoformat(), "seconds": 0, "words": 0, "lookups": 0})
        row = per_day.get(d)
        seconds = int(row.seconds) if row else 0
        b["seconds"] += seconds
        b["words"] += int(row.words) if row else 0
        b["lookups"] += lookups_per_day.get(d, 0)
        if goal.enabled and d.weekday() in goal.days and d < today:
            goal_days += 1
            goal_met += seconds >= goal.minutes * 60
        d += timedelta(days=1)

    all_days = {r.day for r in db.execute(text("""
        SELECT (started_at AT TIME ZONE :tz)::date AS day FROM reading_sessions WHERE reader_email = :e
        GROUP BY 1 HAVING sum(seconds) >= :min"""), {**p, "min": STREAK_SECONDS})}
    current, best = _streaks(all_days, today)
    today_seconds = int(per_day[today].seconds) if today in per_day else 0

    books = [dict(r._mapping) for r in db.execute(text(f"""
        SELECT s.book_id, b.title, b.language, b.word_count, sum(s.seconds) AS seconds, sum(s.words) AS words,
               count(*) AS sessions, max(s.ended_at) AS last_read, coalesce(rs.progress, 0) AS progress
        FROM reading_sessions s JOIN books b ON b.id = s.book_id
        LEFT JOIN reading_state rs ON rs.reader_email = s.reader_email AND rs.book_id = s.book_id
        WHERE s.reader_email = :e AND s.started_at >= :since {book_filter}
        GROUP BY s.book_id, b.title, b.language, b.word_count, rs.progress ORDER BY max(s.ended_at) DESC"""), p)]
    for b in books:
        minutes = b["seconds"] / 60
        b["wpm"] = round(b["words"] / minutes) if minutes >= 1 and b["words"] else None
        left = (1 - b["progress"]) * b["word_count"] if b["word_count"] else None
        b["minutes_left"] = round(left / b["wpm"]) if left is not None and b["wpm"] else None

    heatmap = [[0] * 24 for _ in range(7)]
    for r in db.execute(text(f"""
        SELECT extract(isodow FROM s.started_at AT TIME ZONE :tz)::int - 1 AS dow,
               extract(hour FROM s.started_at AT TIME ZONE :tz)::int AS hour, sum(s.seconds) AS seconds
        FROM reading_sessions s WHERE s.reader_email = :e AND s.started_at >= :since {book_filter}
        GROUP BY 1, 2"""), p):
        heatmap[r.dow][r.hour] = int(r.seconds)

    # lookups per 1000 words read, per language and bucket (words from sessions in books of that language)
    density: dict[str, list] = {}
    words_by = {(r.language, r.bucket): int(r.words) for r in db.execute(text(f"""
        SELECT b.language, date_trunc(:unit, s.started_at AT TIME ZONE :tz)::date AS bucket, sum(s.words) AS words
        FROM reading_sessions s JOIN books b ON b.id = s.book_id
        WHERE s.reader_email = :e AND s.started_at >= :since {book_filter} GROUP BY 1, 2"""),
        {**p, "unit": "week" if weekly else "day"})}
    lookups_by = {(r.language, r.bucket): int(r.n) for r in db.execute(text(f"""
        SELECT l.language, date_trunc(:unit, l.created_at AT TIME ZONE :tz)::date AS bucket, count(*) AS n
        FROM lookups l WHERE l.reader_email = :e AND l.created_at >= :since {lookup_filter} GROUP BY 1, 2"""),
        {**p, "unit": "week" if weekly else "day"})}
    for language in sorted({k[0] for k in words_by} | {k[0] for k in lookups_by}):
        series = []
        for start in sorted(buckets):
            words = words_by.get((language, start), 0)
            series.append({"start": start.isoformat(),
                           "value": round(lookups_by.get((language, start), 0) * 1000 / words, 2) if words >= 200 else None})
        total_words = sum(v for (lang, _), v in words_by.items() if lang == language)
        total_lookups = sum(v for (lang, _), v in lookups_by.items() if lang == language)
        density[language] = {"series": series, "words": total_words, "lookups": total_lookups,
                             "per_1000": round(total_lookups * 1000 / total_words, 2) if total_words else None}

    repeated = [dict(r._mapping) for r in db.execute(text(f"""
        SELECT lower(coalesce(nullif(l.matched, ''), l.word)) AS word, l.language, count(*) AS times,
               max(l.created_at) AS last
        FROM lookups l WHERE l.reader_email = :e {lookup_filter}
          AND lower(coalesce(nullif(l.matched, ''), l.word)) NOT IN
              (SELECT k.word FROM known_words k WHERE k.reader_email = :e AND k.language = l.language)
        GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY count(*) DESC, max(l.created_at) DESC LIMIT 20"""), p)]
    not_found = [dict(r._mapping) for r in db.execute(text(f"""
        SELECT l.word, l.language, count(*) AS times FROM lookups l
        WHERE l.reader_email = :e AND NOT l.found {lookup_filter}
        GROUP BY 1, 2 ORDER BY count(*) DESC, max(l.created_at) DESC LIMIT 20"""), p)]
    translation_filter = "AND t.book_id = :book" if book_id else ""
    translations = [dict(r._mapping) for r in db.execute(text(f"""
        SELECT date_trunc(:unit, t.created_at AT TIME ZONE :tz)::date AS start, count(*) AS count,
               round(avg(length(t.source_text))) AS avg_chars
        FROM translations t WHERE t.reader_email = :e AND t.created_at >= :since {translation_filter}
        GROUP BY 1 ORDER BY 1"""), {**p, "unit": "week" if weekly else "day"})]

    due = db.execute(text("""SELECT count(*) FROM review_cards WHERE reader_email = :e AND NOT deleted
                             AND due <= now()"""), p).scalar()
    known = db.execute(text("SELECT count(*) FROM known_words WHERE reader_email = :e"), p).scalar()
    return {
        "review_due": due, "known_words": known,
        "period": period, "bucket": "week" if weekly else "day", "today": today.isoformat(),
        "buckets": [buckets[k] for k in sorted(buckets)],
        "totals": {"seconds": sum(b["seconds"] for b in buckets.values()), "words": sum(b["words"] for b in buckets.values()),
                   "lookups": sum(b["lookups"] for b in buckets.values())},
        "today_seconds": today_seconds,
        "streak": {"current": current, "best": best},
        "goal": {**goal.model_dump(), "days_met": goal_met, "days_due": goal_days} if goal.enabled else None,
        "books": books, "heatmap": heatmap, "density": density,
        "repeated": repeated, "not_found": not_found, "translations": translations,
    }


