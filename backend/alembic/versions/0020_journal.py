"""a drop can go to the inbox's running file (journal.md, appended to) instead of a file of its own

Revision ID: 0020
Revises: 0019
"""
from alembic import op

revision = "0020"
down_revision = "0019"


def upgrade() -> None:
    op.execute("ALTER TABLE drops ADD COLUMN append boolean NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE drops DROP COLUMN append")
