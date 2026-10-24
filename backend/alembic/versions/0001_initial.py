"""readers, login codes, books, dictionaries, translations, reading state

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None


def _asset_table(name: str, *columns: sa.Column) -> None:
    """Books and dictionaries share the upload life cycle. `files` holds the files that are in R2, `pending`
    the ones being uploaded; both map a kind (pdf, epub, mdbook, cover / sqlite, jsonl, res) to
    {key, size, sha256, content_type}. A row is listed once its first upload is committed ('ready'), and
    adding a format later (a reflow copy) doesn't hide the book meanwhile."""
    op.create_table(
        name,
        sa.Column("id", sa.Text, primary_key=True),
        *columns,
        sa.Column("files", JSONB, nullable=False, server_default="{}"),
        sa.Column("pending", JSONB, nullable=False, server_default="{}"),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'ready')", name=f"{name}_status_check"),
    )


def upgrade() -> None:
    op.create_table(
        "readers",
        sa.Column("email", sa.Text, primary_key=True),  # stored lowercase
        sa.Column("name", sa.Text, nullable=False, server_default=""),
        sa.Column("is_admin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "login_codes",
        sa.Column("email", sa.Text, primary_key=True),
        sa.Column("code", sa.Text, nullable=False),  # '' once used
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("send_count", sa.Integer, nullable=False, server_default="1"),
        sa.Column("send_window_start", sa.DateTime(timezone=True), nullable=False),
    )
    _asset_table(
        "books",
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("author", sa.Text, nullable=False, server_default=""),
        sa.Column("language", sa.Text, nullable=False),  # ISO 639-1, e.g. de
    )
    _asset_table(
        "dictionaries",
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("from_lang", sa.Text, nullable=False),
        sa.Column("to_lang", sa.Text, nullable=False),  # same as from_lang for a monolingual dictionary
        sa.Column("entry_count", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "translations",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("reader_email", sa.Text, sa.ForeignKey("readers.email"), nullable=False),
        sa.Column("book_id", sa.Text),  # no FK: the history outlives a deleted book
        sa.Column("location", sa.Text, nullable=False, server_default=""),
        sa.Column("source_text", sa.Text, nullable=False),
        sa.Column("context", sa.Text, nullable=False, server_default=""),
        sa.Column("source_lang", sa.Text, nullable=False, server_default=""),
        sa.Column("target_lang", sa.Text, nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("prompt_version", sa.Integer, nullable=False),
        sa.Column("cache_key", sa.Text, nullable=False),  # sha256 of text, context, langs, model, prompt version
        sa.Column("result", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("translations_reader_created_idx", "translations", ["reader_email", "created_at"])
    op.create_index("translations_cache_key_idx", "translations", ["cache_key"])
    op.create_table(
        "reading_state",
        sa.Column("reader_email", sa.Text, sa.ForeignKey("readers.email"), primary_key=True),
        sa.Column("book_id", sa.Text, primary_key=True),
        sa.Column("format", sa.Text, nullable=False),
        sa.Column("location", sa.Text, nullable=False),
        sa.Column("progress", sa.Float, nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),  # set by the device: last write wins
    )


def downgrade() -> None:
    for table in ("reading_state", "translations", "dictionaries", "books", "login_codes", "readers"):
        op.drop_table(table)
