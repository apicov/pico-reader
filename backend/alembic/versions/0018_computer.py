"""the study computer: a per-reader mailbox of things sent from the app (drops), when the computer last synced,
and where each note came from

Revision ID: 0018
Revises: 0017
"""
from alembic import op

revision = "0018"
down_revision = "0017"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE drops (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            kind text NOT NULL CHECK (kind IN ('highlight', 'snippet', 'note', 'text')),
            title text NOT NULL DEFAULT '',
            language text NOT NULL DEFAULT '',
            body text NOT NULL,
            meta jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now(),
            delivered_at timestamptz
        )""")
    op.execute("CREATE INDEX drops_pending_idx ON drops (reader_email, created_at) WHERE delivered_at IS NULL")
    op.execute("""
        CREATE TABLE computers (
            reader_email text PRIMARY KEY REFERENCES readers(email),
            seen_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("ALTER TABLE notes ADD COLUMN origin text NOT NULL DEFAULT 'chat' CHECK (origin IN ('chat', 'app', 'computer'))")


def downgrade() -> None:
    op.execute("ALTER TABLE notes DROP COLUMN origin")
    op.execute("DROP TABLE computers")
    op.execute("DROP TABLE drops")
