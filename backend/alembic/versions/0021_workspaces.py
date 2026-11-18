"""workspaces: named sets of books open at the same time (the reader's tabs), synced between devices; a deleted one
stays as a tombstone so an older change from another device can't bring it back

Revision ID: 0021
Revises: 0020
"""
from alembic import op

revision = "0021"
down_revision = "0020"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE workspaces (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            name text NOT NULL,
            book_ids jsonb NOT NULL DEFAULT '[]',
            position integer NOT NULL DEFAULT 0,
            deleted boolean NOT NULL DEFAULT false,
            updated_at timestamptz NOT NULL
        )""")
    op.execute("CREATE INDEX workspaces_reader_idx ON workspaces (reader_email)")


def downgrade() -> None:
    op.execute("DROP TABLE workspaces")
