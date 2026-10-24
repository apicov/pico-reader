"""Login codes, stored in the DB so every worker process sees them.

Copied from tsp-publisher (same rules as the_stitch_tracker):
codes expire after 10 minutes, 5 attempts per code, at most 3 codes per email per hour.
"""

import hmac
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CODE_EXPIRATION_MINUTES = 10
MAX_VERIFICATION_ATTEMPTS = 5
MAX_CODES_PER_EMAIL_PER_HOUR = 3


def store_verification_code(db: Session, email: str, code: str) -> bool:
    """Store a new code for `email`. False when the hourly send limit is reached."""
    email = email.lower().strip()
    now = datetime.now(timezone.utc)
    _cleanup(db, now)

    row = db.execute(
        text("SELECT send_count, send_window_start FROM login_codes WHERE email = :e"), {"e": email}
    ).fetchone()
    if row is not None and row.send_window_start > now - timedelta(hours=1):
        if row.send_count >= MAX_CODES_PER_EMAIL_PER_HOUR:
            db.commit()
            logger.warning("Login code rate limit reached for %s", email)
            return False
        send_count, window_start = row.send_count + 1, row.send_window_start
    else:
        send_count, window_start = 1, now

    db.execute(
        text("""
            INSERT INTO login_codes (email, code, expires_at, attempts, send_count, send_window_start)
            VALUES (:e, :code, :expires, 0, :count, :window)
            ON CONFLICT (email) DO UPDATE SET
                code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, attempts = 0,
                send_count = EXCLUDED.send_count, send_window_start = EXCLUDED.send_window_start
        """),
        {"e": email, "code": code, "expires": now + timedelta(minutes=CODE_EXPIRATION_MINUTES),
         "count": send_count, "window": window_start},
    )
    db.commit()
    return True


def verify_code(db: Session, email: str, code: str) -> bool:
    """Check a code. Single use; the attempt is counted in the same statement so guesses can't race."""
    email = email.lower().strip()
    now = datetime.now(timezone.utc)
    row = db.execute(
        text("""
            UPDATE login_codes SET attempts = attempts + 1
            WHERE email = :e AND code <> '' AND expires_at > :now AND attempts < :max
            RETURNING code
        """),
        {"e": email, "now": now, "max": MAX_VERIFICATION_ATTEMPTS},
    ).fetchone()
    if row is None:
        db.commit()
        return False
    ok = hmac.compare_digest(row.code, code)
    if ok:
        # Keep the row: it carries the hourly send counter
        db.execute(text("UPDATE login_codes SET code = '' WHERE email = :e"), {"e": email})
    db.commit()
    return ok


def _cleanup(db: Session, now: datetime) -> None:
    db.execute(
        text("DELETE FROM login_codes WHERE expires_at < :now AND send_window_start < :window"),
        {"now": now, "window": now - timedelta(hours=1)},
    )
