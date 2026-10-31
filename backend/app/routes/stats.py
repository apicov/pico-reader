"""Reading statistics and the reader's AI use (app/stats_service.py)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import stats_service
from app.auth import Reader, get_current_reader
from app.db import get_db
from app.errors import Invalid

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
def stats(period: str = "week", tz: str = "UTC", book_id: str | None = None,
          reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return stats_service.reading_stats(db, reader.email, period, tz, book_id)


@router.get("/usage")
def usage(period: str = "month", tz: str = "UTC", reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The reader's own AI use: tokens per purpose and per day."""
    if period not in (*stats_service.PERIODS, "all"):
        raise Invalid( "period is week, month, year or all")
    return stats_service.usage_summary(db, reader.email, period, tz)
