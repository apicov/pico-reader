"""tokens used per Groq call, per reader and purpose

Revision ID: 0010
Revises: 0009
"""
from alembic import op

revision = "0010"
down_revision = "0009"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE llm_usage (
            id bigserial PRIMARY KEY,
            reader_email text NOT NULL REFERENCES readers(email),
            purpose text NOT NULL,          -- translate, define, chat, chat_title, search, ask
            model text NOT NULL DEFAULT '',
            prompt_tokens integer NOT NULL DEFAULT 0,
            completion_tokens integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX llm_usage_reader_idx ON llm_usage (reader_email, created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE llm_usage")
