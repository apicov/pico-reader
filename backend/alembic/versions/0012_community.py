"""community: profiles, reviews, posts with linked books and quotes, comments, likes, top lists

Revision ID: 0012
Revises: 0011
"""
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade() -> None:
    # What other readers see of a reader: never the email
    op.execute("""
        CREATE TABLE profiles (
            reader_email text PRIMARY KEY REFERENCES readers(email) ON DELETE CASCADE,
            handle text NOT NULL UNIQUE,
            display_name text NOT NULL DEFAULT '',
            bio text NOT NULL DEFAULT '',
            show_reading boolean NOT NULL DEFAULT true,
            chosen boolean NOT NULL DEFAULT false,   -- false while the handle is the generated one
            avatar bytea,                            -- a small JPEG, served at /api/avatars/<avatar_key>.jpg
            avatar_key text UNIQUE,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("""
        INSERT INTO profiles (reader_email, handle, display_name)
        SELECT email,
               left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]', '_', 'g'), 14)
                   || '_' || substr(md5(email), 1, 4),
               name
        FROM readers""")
    # Books are referenced by id without a foreign key: posts and lists outlive a deleted book
    op.execute("""
        CREATE TABLE reviews (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            book_id text NOT NULL,
            reader_email text NOT NULL REFERENCES readers(email) ON DELETE CASCADE,
            score smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
            recommend boolean NOT NULL DEFAULT false,
            body text NOT NULL DEFAULT '',
            spoiler boolean NOT NULL DEFAULT false,
            hidden_by_admin boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (book_id, reader_email)
        )""")
    op.execute("""
        CREATE TABLE posts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            author_email text NOT NULL REFERENCES readers(email) ON DELETE CASCADE,
            title text NOT NULL,
            body text NOT NULL DEFAULT '',
            edited boolean NOT NULL DEFAULT false,
            hidden_by_admin boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX posts_created_idx ON posts (created_at DESC)")
    op.execute("""
        CREATE TABLE post_books (
            post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            book_id text NOT NULL,
            PRIMARY KEY (post_id, book_id)
        )""")
    op.execute("CREATE INDEX post_books_book_idx ON post_books (book_id)")
    op.execute("""
        CREATE TABLE post_quotes (
            post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            position smallint NOT NULL,
            book_id text NOT NULL,
            text text NOT NULL,
            format text NOT NULL,
            location text NOT NULL DEFAULT '',
            progress real NOT NULL DEFAULT 0,
            PRIMARY KEY (post_id, position)
        )""")
    op.execute("""
        CREATE TABLE comments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
            author_email text NOT NULL REFERENCES readers(email) ON DELETE CASCADE,
            body text NOT NULL,
            spoiler boolean NOT NULL DEFAULT false,
            edited boolean NOT NULL DEFAULT false,
            deleted boolean NOT NULL DEFAULT false,   -- kept as "comment deleted" so replies stay in place
            hidden_by_admin boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX comments_post_idx ON comments (post_id, created_at)")
    op.execute("""
        CREATE TABLE likes (
            target_type text NOT NULL CHECK (target_type IN ('post', 'comment', 'review')),
            target_id uuid NOT NULL,
            reader_email text NOT NULL REFERENCES readers(email) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (target_type, target_id, reader_email)
        )""")
    op.execute("""
        CREATE TABLE lists (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_email text NOT NULL REFERENCES readers(email) ON DELETE CASCADE,
            title text NOT NULL,
            description text NOT NULL DEFAULT '',
            hidden_by_admin boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("""
        CREATE TABLE list_items (
            list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            rank smallint NOT NULL,
            book_id text NOT NULL,
            note text NOT NULL DEFAULT '',
            PRIMARY KEY (list_id, rank)
        )""")


def downgrade() -> None:
    for table in ("list_items", "lists", "likes", "comments", "post_quotes", "post_books", "posts", "reviews", "profiles"):
        op.execute(f"DROP TABLE {table}")
