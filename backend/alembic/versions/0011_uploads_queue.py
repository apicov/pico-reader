"""uploads by readers: who added a book, the history of book changes, the indexing queue

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade() -> None:
    op.execute("ALTER TABLE books ADD COLUMN uploaded_by text")
    # Append-only, no foreign key: the history of a book outlives its deletion
    op.execute("""
        CREATE TABLE book_events (
            id bigserial PRIMARY KEY,
            book_id text NOT NULL,
            title text NOT NULL DEFAULT '',
            action text NOT NULL,            -- uploaded, files_changed, deleted, reindexed, indexed, index_failed
            actor text NOT NULL,             -- a reader's email, or "indexer"
            details jsonb NOT NULL DEFAULT '{}',
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX book_events_created_idx ON book_events (created_at DESC)")
    op.execute("""
        CREATE TABLE index_jobs (
            id bigserial PRIMARY KEY,
            book_id text NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            format text NOT NULL,
            sha256 text NOT NULL,
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
            error text NOT NULL DEFAULT '',
            attempts integer NOT NULL DEFAULT 0,
            requested_by text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            started_at timestamptz,
            finished_at timestamptz
        )""")
    op.execute("CREATE INDEX index_jobs_status_idx ON index_jobs (status, id)")


def downgrade() -> None:
    op.execute("DROP TABLE index_jobs")
    op.execute("DROP TABLE book_events")
    op.execute("ALTER TABLE books DROP COLUMN uploaded_by")
