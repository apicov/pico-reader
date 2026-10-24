"""book categories: a shared tree (up to 3 levels) and each book's main and second category

Revision ID: 0014
Revises: 0013
"""
import re

from alembic import op
from sqlalchemy import text

revision = "0014"
down_revision = "0013"

SCIENCE_FICTION = ["Space opera", "Hard SF", "Cyberpunk", "Dystopia & post-apocalyptic",
                   "Time travel & alternate history", "First contact & aliens", "Military SF"]
FANTASY = ["Epic & high fantasy", "Urban fantasy", "Dark fantasy", "Sword & sorcery", "Myths & fairy tales",
           "Magical realism"]
TREE = {
    "Literature": {"Classics": {}, "Contemporary fiction": {}, "Crime & thriller": {}, "Historical fiction": {},
                   "Horror": {}, "Young adult & children": {}, "Short stories": {}, "Poetry & drama": {},
                   "Graded readers": {}, "Science fiction": {n: {} for n in SCIENCE_FICTION},
                   "Fantasy": {n: {} for n in FANTASY}},
    "Academic": {n: {} for n in ["Computer science & AI", "Mathematics & statistics", "Physics & engineering",
                                 "Biology & medicine", "Economics & business", "Psychology & philosophy", "History",
                                 "Linguistics & languages", "Social sciences"]},
    "Non-fiction": {n: {} for n in ["Biography & memoir", "Popular science", "History & politics", "Society & essays",
                                    "Personal development", "Travel & nature", "Language learning"]},
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE categories (
            id serial PRIMARY KEY,
            parent_id integer REFERENCES categories(id) ON DELETE CASCADE,
            name text NOT NULL,
            slug text NOT NULL,
            status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'suggested')),
            suggested_by text,
            position integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    # one name per parent (top-level ones too)
    op.execute("CREATE UNIQUE INDEX categories_name_idx ON categories (coalesce(parent_id, 0), lower(name))")
    op.execute("""ALTER TABLE books
                  ADD COLUMN category_id integer REFERENCES categories(id) ON DELETE SET NULL,
                  ADD COLUMN category2_id integer REFERENCES categories(id) ON DELETE SET NULL,
                  ADD COLUMN category_source text CHECK (category_source IN ('llm', 'reader')),
                  ADD COLUMN category_reason text NOT NULL DEFAULT ''""")
    seed(op.get_bind())


def seed(conn, nodes: dict = TREE, parent: int | None = None) -> None:
    """The starting tree (the tests reset to it too)."""
    for position, (name, children) in enumerate(nodes.items()):
        new_id = conn.execute(text("""INSERT INTO categories (parent_id, name, slug, position)
                                      VALUES (:p, :n, :s, :o) RETURNING id"""),
                              {"p": parent, "n": name, "s": slug(name), "o": position}).scalar()
        seed(conn, children, new_id)


def downgrade() -> None:
    op.execute("ALTER TABLE books DROP COLUMN category_id, DROP COLUMN category2_id, DROP COLUMN category_source, "
               "DROP COLUMN category_reason")
    op.execute("DROP TABLE categories")
