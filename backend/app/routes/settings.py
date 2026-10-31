"""The reader's settings in the account (app/settings_service.py)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db
from app.settings_service import ReaderSettings, load_settings, save_settings

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=ReaderSettings)
def get(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return load_settings(db, reader.email)


@router.put("/settings", response_model=ReaderSettings)
def put(body: ReaderSettings, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Saves the parts sent (e.g. only the reading goal); the others stay as they are."""
    return save_settings(db, reader.email, body)
