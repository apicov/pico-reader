""""My shelf": books a reader picks to keep in sight, whatever their reading status

Revision ID: 0015
Revises: 0014
"""
from alembic import op

revision = "0015"
down_revision = "0014"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE my_shelf (
            reader_email text NOT NULL REFERENCES readers(email),
            book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            added_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (reader_email, book_id)
        )""")


def downgrade() -> None:
    op.execute("DROP TABLE my_shelf")
