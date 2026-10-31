"""Tools about the reader's reading: time, lookups, review cards, the reading goal, their AI use."""

from datetime import UTC, datetime

from sqlalchemy import text

from app import stats_service
from app.agent.registry import Context, book_or_error, stats_of
from app.settings_service import load_settings


def reading_stats(ctx: Context, period: str = "week", book: str | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    s = stats_of(ctx, period, found["id"] if found else None)
    return {"period": period, "unit": s["bucket"],
            "minutes": round(s["totals"]["seconds"] / 60), "words": s["totals"]["words"], "lookups": s["totals"]["lookups"],
            "today_minutes": round(s["today_seconds"] / 60), "streak_days": s["streak"],
            "goal": s["goal"], "per_" + s["bucket"]: [{"start": b["start"], "minutes": round(b["seconds"] / 60),
                                                       "words": b["words"]} for b in s["buckets"]],
            "books": [{"title": b["title"], "minutes": round(b["seconds"] / 60), "words_per_minute": b["wpm"],
                       "progress_percent": round(b["progress"] * 100), "minutes_left": b["minutes_left"]} for b in s["books"]]}

def lookup_stats(ctx: Context, period: str = "month", language: str | None = None) -> dict:
    s = stats_of(ctx, period)
    density = {lang: {"lookups": d["lookups"], "words_read": d["words"], "lookups_per_1000_words": d["per_1000"],
                      "trend": [p for p in d["series"] if p["value"] is not None][-12:]}
               for lang, d in s["density"].items() if not language or lang == language}
    keep = lambda rows: [r for r in rows if not language or r["language"] == language][:15]
    return {"period": period, "by_language": density,
            "words_looked_up_repeatedly": [{"word": r["word"], "times": r["times"]} for r in keep(s["repeated"])],
            "not_found_in_dictionaries": [{"word": r["word"], "times": r["times"]} for r in keep(s["not_found"])],
            "known_words": s["known_words"], "review_due": s["review_due"]}

def vocabulary_due(ctx: Context, language: str | None = None) -> dict:
    rows = ctx.db.execute(text("""
        SELECT term, language, due FROM review_cards WHERE reader_email = :e AND NOT deleted
          AND (CAST(:l AS text) IS NULL OR language = :l) ORDER BY due LIMIT 200"""),
        {"e": ctx.reader.email, "l": language}).fetchall()
    now = datetime.now(UTC)
    due = [r for r in rows if r.due <= now]
    return {"cards": len(rows), "due_now": len(due), "due_terms": [r.term for r in due[:20]],
            "next_due": min((r.due for r in rows if r.due > now), default=None)}

def reading_goal(ctx: Context) -> dict:
    return load_settings(ctx.db, ctx.reader.email).reading_goal.model_dump()

def ai_usage(ctx: Context, period: str = "month") -> dict:
    return stats_service.usage_summary(ctx.db, ctx.reader.email, period if period in ("week", "month", "year", "all") else "month", ctx.tz)
