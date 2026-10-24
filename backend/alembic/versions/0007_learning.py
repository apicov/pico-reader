"""known words, review cards (spaced repetition), the sentence of a lookup

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE known_words (
            reader_email text NOT NULL REFERENCES readers(email),
            language text NOT NULL,
            word text NOT NULL,  -- lower case
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (reader_email, language, word)
        )""")
    # Synced like annotations: ids from the device, newest edit wins, deletions kept as tombstones.
    # `state` is the FSRS card the app schedules with (ts-fsrs); `due` is copied out of it for queries.
    op.execute("""
        CREATE TABLE review_cards (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            language text NOT NULL,
            term text NOT NULL,
            meaning text NOT NULL DEFAULT '',
            example text NOT NULL DEFAULT '',
            source text NOT NULL DEFAULT 'lookup',
            book_id text,
            state jsonb NOT NULL DEFAULT '{}',
            due timestamptz NOT NULL DEFAULT now(),
            deleted boolean NOT NULL DEFAULT false,
            client_updated_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )""")
    op.execute("CREATE INDEX review_cards_sync_idx ON review_cards (reader_email, updated_at)")
    op.execute("ALTER TABLE lookups ADD COLUMN context text NOT NULL DEFAULT ''")


def downgrade() -> None:
    op.execute("ALTER TABLE lookups DROP COLUMN context")
    op.execute("DROP TABLE review_cards")
    op.execute("DROP TABLE known_words")
