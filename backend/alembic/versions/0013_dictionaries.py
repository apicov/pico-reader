"""dictionaries: visibility (everyone, or only the uploader), who uploaded, and the conversion queue for
StarDict uploads from the app

Revision ID: 0013
Revises: 0012
"""
from alembic import op

revision = "0013"
down_revision = "0012"


def upgrade() -> None:
    op.execute("""ALTER TABLE dictionaries
                  ADD COLUMN visibility text NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'private')),
                  ADD COLUMN uploaded_by text""")
    # No foreign key: a job outlives a dictionary deleted while it waited
    op.execute("""
        CREATE TABLE dict_jobs (
            id bigserial PRIMARY KEY,
            dict_id text NOT NULL,
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
            error text NOT NULL DEFAULT '',
            attempts integer NOT NULL DEFAULT 0,
            requested_by text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            started_at timestamptz,
            finished_at timestamptz
        )""")
    op.execute("CREATE INDEX dict_jobs_status_idx ON dict_jobs (status, id)")


def downgrade() -> None:
    op.execute("DROP TABLE dict_jobs")
    op.execute("ALTER TABLE dictionaries DROP COLUMN uploaded_by, DROP COLUMN visibility")
