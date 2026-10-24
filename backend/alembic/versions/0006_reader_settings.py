"""settings kept on the server (shared by every device): the reading goal

Revision ID: 0006
Revises: 0005
"""
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE reader_settings (
            reader_email text PRIMARY KEY REFERENCES readers(email),
            settings jsonb NOT NULL DEFAULT '{}',
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")


def downgrade() -> None:
    op.execute("DROP TABLE reader_settings")
