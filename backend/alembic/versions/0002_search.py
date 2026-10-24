"""book chunks for search (pgvector + full text)

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # Which file of a book is indexed, with which embedding model (a new file or model means re-indexing)
    op.execute("""
        CREATE TABLE book_index (
            book_id text PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            format text NOT NULL,
            sha256 text NOT NULL,
            model text NOT NULL,
            chunks integer NOT NULL DEFAULT 0,
            indexed_at timestamptz NOT NULL DEFAULT now()
        )""")
    # Passages of ~1000 characters; `location` and `progress` open the reader there
    op.execute("""
        CREATE TABLE book_chunks (
            id bigserial PRIMARY KEY,
            book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            seq integer NOT NULL,
            format text NOT NULL,
            location text NOT NULL DEFAULT '',
            progress real NOT NULL DEFAULT 0,
            heading text NOT NULL DEFAULT '',
            text text NOT NULL,
            embedding vector(384) NOT NULL,
            tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', heading || ' ' || text)) STORED
        )""")
    op.execute("CREATE INDEX book_chunks_book_idx ON book_chunks (book_id, seq)")
    op.execute("CREATE INDEX book_chunks_embedding_idx ON book_chunks USING hnsw (embedding vector_cosine_ops)")
    op.execute("CREATE INDEX book_chunks_tsv_idx ON book_chunks USING gin (tsv)")


def downgrade() -> None:
    op.execute("DROP TABLE book_chunks")
    op.execute("DROP TABLE book_index")
