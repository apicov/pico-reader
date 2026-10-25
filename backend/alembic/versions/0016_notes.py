"""notes: Markdown documents a reader keeps (the chat agent writes them on request), private to the reader

Revision ID: 0016
Revises: 0015
"""
from alembic import op

revision = "0016"
down_revision = "0015"


def upgrade() -> None:
    # `sources`: the passages the note's [n] citations point to (kept with the note, the chat may be deleted)
    op.execute("""
        CREATE TABLE notes (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text REFERENCES books(id) ON DELETE SET NULL,
            title text NOT NULL,
            markdown text NOT NULL,
            sources jsonb NOT NULL DEFAULT '[]',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX notes_reader_idx ON notes (reader_email, updated_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE notes")
