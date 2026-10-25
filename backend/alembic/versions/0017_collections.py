"""collections: named groups of a reader's My-shelf books (a book can be in several)

Revision ID: 0017
Revises: 0016
"""
from alembic import op

revision = "0017"
down_revision = "0016"


def upgrade() -> None:
    # ids are made on the device (collections can be made offline)
    op.execute("""
        CREATE TABLE collections (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            name text NOT NULL,
            position integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX collections_reader_idx ON collections (reader_email)")
    op.execute("""
        CREATE TABLE collection_books (
            collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            added_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (collection_id, book_id)
        )""")


def downgrade() -> None:
    op.execute("DROP TABLE collection_books")
    op.execute("DROP TABLE collections")
