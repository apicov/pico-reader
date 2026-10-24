"""highlights and bookmarks

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    # Ids are made on the device (offline first). `client_updated_at` decides between two devices' edits
    # (newest wins); `updated_at` is server time, the cursor devices sync from. Deleting keeps a tombstone
    # so other devices learn about it.
    op.execute("""
        CREATE TABLE annotations (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text NOT NULL,
            kind text NOT NULL CHECK (kind IN ('highlight', 'bookmark')),
            format text NOT NULL,
            location text NOT NULL DEFAULT '',
            progress real NOT NULL DEFAULT 0,
            text text NOT NULL DEFAULT '',
            note text NOT NULL DEFAULT '',
            color text NOT NULL DEFAULT '',
            deleted boolean NOT NULL DEFAULT false,
            client_updated_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )""")
    op.execute("CREATE INDEX annotations_sync_idx ON annotations (reader_email, updated_at)")


def downgrade() -> None:
    op.execute("DROP TABLE annotations")
