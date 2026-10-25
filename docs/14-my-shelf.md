# 14 — My shelf

The library has four tabs: **All books**, **My shelf**, **Reading**, **Finished**. The last tab chosen is
remembered on the device.

- **Reading** and **Finished** fill themselves: opening a book puts it on Reading, reading to 98% moves it to
  Finished (table `shelf`, one status per reader and book; ⋮ → *Remove from my lists* hides it from both).
- **My shelf** holds only what the reader puts there with ⋮ → **Add to My shelf**, whatever its status: books
  to read next, favourites read long ago, the one being read now. Newest added first. It's a separate table
  (`my_shelf`), so reading, finishing or removing a book never takes it off My shelf.

On My shelf and All books, a cover shows **Reading · N%** or **Finished ✓**. In All books, the title of a book
on My shelf has a bookmark mark. Changes made offline are kept on the device and sent when the connection is
back, like the status shelf. The chat agent's `list_books` says for each book whether it's on My shelf.

## Collections

On My shelf, books can be grouped in **collections** (a book can be in several). Chips above the books filter
them: *All · <collection> (n) … · Not in a collection*; the last choice is remembered on the device.
**Collections…** (the last chip) creates, renames, deletes and orders them; a book's ⋮ → **Collections…** ticks
the ones it's in, or makes a new one for it.

- Adding a book to a collection puts it on My shelf; taking it off My shelf takes it out of its collections.
- Deleting a collection never touches its books (they stay on My shelf).
- Made offline too: changes are shown at once and sent in the order they were made (`collections_pending`).
- Tables `collections` (ids made on the device, `col-<uuid>`; at most 100 per reader, names up to 60
  characters) and `collection_books`. The chat agent's `list_books` names each book's collections.

## API

| Route | |
|---|---|
| `GET /api/shelf/mine` | `[{book_id, added_at}]`, newest first |
| `PUT /api/shelf/mine/{book_id}` | Add (adding twice is fine; 404 for an unknown book) |
| `DELETE /api/shelf/mine/{book_id}` | Remove |
| `GET /api/shelf/collections` | `[{id, name, position, book_ids}]`, in order |
| `PUT /api/shelf/collections/{id}` | `{name, position}`: create or rename/move |
| `DELETE /api/shelf/collections/{id}` | Remove (the books stay on My shelf) |
| `PUT` / `DELETE /api/shelf/collections/{id}/books/{book_id}` | Add (also puts it on My shelf) / take out |
