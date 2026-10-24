"""each reader's shelf: which books they're reading, finished or took off the list

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE shelf (
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            status text NOT NULL CHECK (status IN ('reading', 'finished', 'removed')),
            started_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (reader_email, book_id)
        )""")


def downgrade() -> None:
    op.execute("DROP TABLE shelf")
