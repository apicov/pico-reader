"""The reader's database. Tables are created by alembic (backend/alembic)."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True)


def new_session() -> Session:
    """A session of its own (a streamed answer, the indexer, the command line); a request gets one from get_db"""
    return sessionmaker(bind=get_engine())()


def get_db() -> Iterator[Session]:
    session = new_session()
    try:
        yield session
    finally:
        session.close()
