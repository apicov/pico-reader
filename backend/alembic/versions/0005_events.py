"""reading sessions and dictionary lookups (for statistics); books' word count

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade() -> None:
    # Both are recorded on the device (offline too) with their own ids and sent in batches: upserts by id
    op.execute("""
        CREATE TABLE reading_sessions (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text NOT NULL,
            format text NOT NULL,
            started_at timestamptz NOT NULL,
            ended_at timestamptz NOT NULL,
            seconds integer NOT NULL CHECK (seconds >= 0),
            progress_start real NOT NULL DEFAULT 0,
            progress_end real NOT NULL DEFAULT 0,
            words integer NOT NULL DEFAULT 0
        )""")
    op.execute("CREATE INDEX reading_sessions_reader_idx ON reading_sessions (reader_email, started_at)")
    op.execute("""
        CREATE TABLE lookups (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text,
            language text NOT NULL,
            word text NOT NULL,
            matched text NOT NULL DEFAULT '',
            dictionaries jsonb NOT NULL DEFAULT '[]',
            found boolean NOT NULL,
            location text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL
        )""")
    op.execute("CREATE INDEX lookups_reader_idx ON lookups (reader_email, created_at)")
    # Words in the book's text (from the search index), to turn reading progress into words read
    op.execute("ALTER TABLE books ADD COLUMN word_count integer")


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP COLUMN word_count")
    op.execute("DROP TABLE lookups")
    op.execute("DROP TABLE reading_sessions")
