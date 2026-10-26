"""projects on the study computer: a folder there (`reader project add`) with its own notes/ and inbox/; notes
and things sent from the app can belong to one

Revision ID: 0019
Revises: 0018
"""
from alembic import op

revision = "0019"
down_revision = "0018"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE projects (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE UNIQUE INDEX projects_name_idx ON projects (reader_email, lower(name))")
    op.execute("ALTER TABLE notes ADD COLUMN project_id text REFERENCES projects(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE drops ADD COLUMN project_id text REFERENCES projects(id) ON DELETE SET NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE drops DROP COLUMN project_id")
    op.execute("ALTER TABLE notes DROP COLUMN project_id")
    op.execute("DROP TABLE projects")
