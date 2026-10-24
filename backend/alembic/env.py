"""Runs migrations against DATABASE_URL (the same setting the app uses)."""

from alembic import context
from sqlalchemy import create_engine

from app.config import get_settings

with create_engine(get_settings().database_url).connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
