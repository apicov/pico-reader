# 11 Community

Readers share what they think of the books: reviews, discussions and favourite lists. Everything is visible to
everyone signed in and to nobody else. The library itself is shared too (one library for all readers).

## What readers see

| Where | What |
|---|---|
| **Community** (people icon in the top bar, `/community`) | All posts, newest first; filters *All*, *About my books* (books on the reader's shelf), *Mine*; the readers' avatars |
| **Book page** (`/book/<id>`, from a card's ⋮ menu → *Reviews & discussion*) | Average score, how many recommend it, your review (0–10, *I recommend it*, text, *contains spoilers*), the others' reviews, posts about the book |
| **Post** (`/community/post/<id>`) | Title, linked books, quotes, text (Markdown), likes, comments with one level of replies |
| **Profile** (`/u/<handle>`) | Name, picture, bio, *Reading now* (if the reader allows it), finished count, reviews, posts, lists |
| **Lists** (`/lists/<id>`) | An ordered list of books with a note each, e.g. "My top 10" |
| **Library cards** | ★ average score and number of reviews |

- **Quotes:** select text in the reader and tap the speech bubble, or share a highlight from the reader's
  *Notes*. The post shows the passage with *Open here*, which opens the book at that place.
- **Spoilers:** a review or comment can be marked as a spoiler (blurred until tapped). Inside any text,
  `||like this||` hides a part.
- **Finishing a book:** the reader offers once *Rate it*, which leads to the book page.
- **First visit:** the community asks for a name and a handle. Until then the handle is made from the email's
  first part plus four random characters.
- **Chat:** the agent's tools `book_opinions` and `member_lists` answer "what did my friends think of …".

The community needs a connection; offline its pages say so.

## Privacy

Other readers are only ever shown by their profile: handle, name and picture. API responses about other
readers never contain an email; the tests check every community response for one. The library list tells the
app only whether the reader may change a book (`can_change`), not who uploaded it.

Pictures are small JPEGs made on the device (256 px) and stored in Postgres (`profiles.avatar`). They're served
without sign-in at `/api/avatars/<random key>.jpg` (so an `<img>` can load them); the key is random and changes
with every new picture.

## Inviting a friend

On the server, add them to the allowlist:

```bash
cd /home/tsp/code/pico-reader/backend
sudo -u tsp .venv/bin/python -m app.cli add friend@example.com "Their name"
```

They sign in with an email code, as you do, and choose their community name on the first visit. Removing
someone (`python -m app.cli remove <email>`) locks them out at once; what they wrote stays.

## Who may change what

| | Author | Other readers | Admin |
|---|---|---|---|
| Edit a post, comment, review or list | ✓ | | |
| Delete it | ✓ | | ✓ |
| Hide it from everyone (reversible) | | | ✓ |

A deleted comment stays as "Comment deleted" so the replies keep their place. Hidden things are left out for
everyone but admins, who see them dimmed with *Show again*.

## Data

Migration `0012_community`: `profiles`, `reviews` (one per reader and book), `posts`, `post_books`,
`post_quotes`, `comments`, `likes` (posts, comments, reviews), `lists`, `list_items`. Books are referenced by id
without a foreign key: a post or list about a deleted book keeps working and shows "No longer in the library".
The tables are in Postgres, so the daily database backup covers them.

## API

| Route | |
|---|---|
| `GET/PUT /api/profiles/me`, `PUT /api/profiles/me/avatar` | Your profile; picture as base64 JPEG (≤ 150 KB, `null` removes it) |
| `GET /api/profiles/{handle}`, `GET /api/members` | A profile with reviews, posts, lists; everyone |
| `GET /api/books/{id}/community`, `PUT/DELETE /api/books/{id}/review`, `GET /api/ratings` | A book's page; your review; all averages |
| `GET /api/posts?book=&author=&mine_books=&before=`, `GET/POST/PUT/DELETE /api/posts[/{id}]` | Posts (30 per page, older with `before`) |
| `POST /api/posts/{id}/comments`, `PUT/DELETE /api/comments/{id}` | Comments; `parent_id` replies |
| `PUT/DELETE /api/likes/{post\|comment\|review}/{id}` | Like, unlike |
| `GET/POST/PUT/DELETE /api/lists[/{id}]`, `GET /api/lists?owner=` | Top lists |
| `POST/DELETE /api/admin/hide/{post\|comment\|review\|list}/{id}` | Hide, show again (admins) |
