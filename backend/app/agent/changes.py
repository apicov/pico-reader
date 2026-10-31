"""Tools that change the reader's settings and learning (they run after the reader confirms)."""

import uuid

from sqlalchemy import text

from app.agent.registry import Context, stats_of
from app.settings_service import ReaderSettings, load_settings, save_settings


def set_reading_goal(ctx: Context, enabled: bool, minutes: int | None = None, days: list[int] | None = None) -> dict:
    settings = load_settings(ctx.db, ctx.reader.email)
    goal = settings.reading_goal
    goal.enabled = enabled
    if minutes:
        goal.minutes = max(1, min(600, int(minutes)))
    if days:
        goal.days = sorted({d for d in days if 0 <= d <= 6})
    save_settings(ctx.db, ctx.reader.email, ReaderSettings(reading_goal=goal))
    return {"reading_goal": goal.model_dump()}

def mark_known(ctx: Context, words: list[str], language: str) -> dict:
    for w in words[:100]:
        ctx.db.execute(text("""INSERT INTO known_words (reader_email, language, word) VALUES (:e, :l, :w)
                               ON CONFLICT DO NOTHING"""), {"e": ctx.reader.email, "l": language, "w": w.strip().lower()})
        ctx.db.execute(text("""UPDATE review_cards SET deleted = true, client_updated_at = now(), updated_at = clock_timestamp()
                               WHERE reader_email = :e AND language = :l AND lower(term) = :w AND NOT deleted"""),
                       {"e": ctx.reader.email, "l": language, "w": w.strip().lower()})
    ctx.db.commit()
    return {"marked_known": len(words[:100])}

def add_review_cards(ctx: Context, language: str, words: list[str] | None = None, repeated: bool = False) -> dict:
    """Cards for the given words, or for the words looked up repeatedly. The device schedules them (FSRS)."""

    terms = [w.strip() for w in (words or []) if w.strip()]
    if repeated:
        terms += [r["word"] for r in stats_of(ctx, "all")["repeated"] if r["language"] == language]
    added = 0
    for term in dict.fromkeys(terms):
        exists = ctx.db.execute(text("""SELECT 1 FROM review_cards WHERE reader_email = :e AND language = :l
                                        AND lower(term) = lower(:t) AND NOT deleted"""),
                                {"e": ctx.reader.email, "l": language, "t": term}).fetchone()
        if exists:
            continue
        context = ctx.db.execute(text("""SELECT context FROM lookups WHERE reader_email = :e AND language = :l
                                         AND (lower(word) = lower(:t) OR lower(matched) = lower(:t)) AND context <> ''
                                         ORDER BY created_at DESC LIMIT 1"""),
                                 {"e": ctx.reader.email, "l": language, "t": term}).scalar() or ""
        ctx.db.execute(text("""INSERT INTO review_cards (id, reader_email, language, term, example, source, client_updated_at)
                               VALUES (:id, :e, :l, :t, :x, 'manual', now())"""),
                       {"id": f"card-{uuid.uuid4()}", "e": ctx.reader.email, "l": language, "t": term, "x": context[:500]})
        added += 1
    ctx.db.commit()
    return {"added": added, "skipped_existing": len(dict.fromkeys(terms)) - added}
