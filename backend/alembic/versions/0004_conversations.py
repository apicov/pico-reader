"""chat conversations about the library

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade() -> None:
    # Ids come from the device, like annotations; book_ids null = all books
    op.execute("""
        CREATE TABLE conversations (
            id text PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            title text NOT NULL DEFAULT '',
            book_ids jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX conversations_reader_idx ON conversations (reader_email, updated_at DESC)")
    op.execute("""
        CREATE TABLE messages (
            id bigserial PRIMARY KEY,
            conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role text NOT NULL CHECK (role IN ('user', 'assistant')),
            content text NOT NULL,
            sources jsonb NOT NULL DEFAULT '[]',
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX messages_conversation_idx ON messages (conversation_id, id)")
    op.execute("CREATE INDEX messages_text_idx ON messages USING gin (to_tsvector('simple', content))")


def downgrade() -> None:
    op.execute("DROP TABLE messages")
    op.execute("DROP TABLE conversations")
