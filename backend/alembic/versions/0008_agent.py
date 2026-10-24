"""chat agent: what an answer used (tools, links, proposed actions) and the actions awaiting confirmation

Revision ID: 0008
Revises: 0007
"""
from alembic import op

revision = "0008"
down_revision = "0007"


def upgrade() -> None:
    op.execute("ALTER TABLE messages ADD COLUMN extras jsonb NOT NULL DEFAULT '{}'")
    # A tool that changes something runs only after the reader confirms it in the chat
    op.execute("""
        CREATE TABLE chat_actions (
            id text PRIMARY KEY,
            conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            tool text NOT NULL,
            args jsonb NOT NULL,
            label text NOT NULL,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'failed')),
            created_at timestamptz NOT NULL DEFAULT now()
        )""")


def downgrade() -> None:
    op.execute("DROP TABLE chat_actions")
    op.execute("ALTER TABLE messages DROP COLUMN extras")
