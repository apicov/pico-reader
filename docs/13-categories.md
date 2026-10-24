# 13 Categories

Every book sits in a shared category tree, up to three levels deep (Literature › Science fiction › Space opera).
Categories are labels in the database: files in R2, quotes, positions and the search index never move.

## The tree

Migration `0014_categories` starts it with three top levels:

- **Literature**: Classics, Contemporary fiction, Crime & thriller, Historical fiction, Horror, Young adult &
  children, Short stories, Poetry & drama, Graded readers, **Science fiction** (Space opera, Hard SF, Cyberpunk,
  Dystopia & post-apocalyptic, Time travel & alternate history, First contact & aliens, Military SF) and
  **Fantasy** (Epic & high fantasy, Urban fantasy, Dark fantasy, Sword & sorcery, Myths & fairy tales, Magical
  realism).
- **Academic**: Computer science & AI, Mathematics & statistics, Physics & engineering, Biology & medicine,
  Economics & business, Psychology & philosophy, History, Linguistics & languages, Social sciences.
- **Non-fiction**: Biography & memoir, Popular science, History & politics, Society & essays, Personal
  development, Travel & nature, Language learning.

Admins change it in Settings → **Book categories** (`/categories`): add, rename, approve, merge into another
(books and subcategories move along), delete when empty.

## How a book gets its category

A book has a main category and an optional second one (`books.category_id`, `category2_id`).

- **The AI** (`app/categories.py` `classify`): after the indexer has indexed a book (and after the desktop
  tool's `index/finish`), Groq gets the title, author, language, the first headings and about 4,000 characters
  from the start of the book, plus every category path. It answers with the most specific path, an optional
  second, and a one-line reason (kept in `books.category_reason`). Only when nothing fits may it propose a new
  category under an existing first- or second-level one; that one is marked **new** (`status = 'suggested'`)
  until an admin approves, renames or merges it. An answer that breaks the rules leaves the book uncategorised; a
  Groq failure never fails the indexing job. The call is recorded in `llm_usage` as `categorize` (about 1,600
  tokens in), for the uploader.
- **A person**: the uploader can choose a category on the Upload page (the AI then isn't asked), and the
  uploader or an admin can change it with the book's ⋮ → **Category…** (`category_source = 'reader'`; the AI
  never overwrites it). **Suggest again** in that dialog asks the AI on purpose.
- **Existing books**: `python -m app.cli categorize` files every indexed book that has no category;
  `--all` re-asks for the ones the AI filed before (never a person's choice), `--book <id>` one book.

## Browsing

Library → **All books** shows chips: the top levels with their book counts (a book counts for its category and
every one above it, by main or second category), then the chosen one's subcategories, then theirs; plus
**Uncategorised**. The choice is remembered on the device. Each card shows its category's name; the book page
shows the full paths. The chat agent's `list_books` includes each book's category and can filter by one ("which
science fiction books do we have?").

## API

| Route | |
|---|---|
| `GET /api/categories` | The tree: id, parent, name, path, depth, status, book count |
| `GET /api/library` | Books carry `category_id`, `category2_id`, `category_reason` |
| `POST /api/books` | Optional `category_id` (the reader's choice) |
| `PUT /api/books/{id}/category` | `{category_id, category2_id}`; uploader or admin |
| `POST /api/books/{id}/categorize` | Ask the AI again; uploader or admin |
| `POST /api/admin/categories`, `PUT/DELETE /api/admin/categories/{id}`, `POST …/{id}/merge` | Manage the tree |
