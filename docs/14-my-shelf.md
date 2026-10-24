# 14 — My shelf

The library has four tabs: **My shelf**, **Reading**, **All books**, **Finished**. The last tab chosen is
remembered on the device.

- **Reading** and **Finished** fill themselves: opening a book puts it on Reading, reading to 98% moves it to
  Finished (table `shelf`, one status per reader and book; ⋮ → *Remove from my lists* hides it from both).
- **My shelf** holds only what the reader puts there with ⋮ → **Add to My shelf**, whatever its status: books
  to read next, favourites read long ago, the one being read now. Newest added first. It's a separate table
  (`my_shelf`), so reading, finishing or removing a book never takes it off My shelf.

On My shelf and All books, a cover shows **Reading · N%** or **Finished ✓**. In All books, the title of a book
on My shelf has a bookmark mark. Changes made offline are kept on the device and sent when the connection is
back, like the status shelf. The chat agent's `list_books` says for each book whether it's on My shelf.

## API

| Route | |
|---|---|
| `GET /api/shelf/mine` | `[{book_id, added_at}]`, newest first |
| `PUT /api/shelf/mine/{book_id}` | Add (adding twice is fine; 404 for an unknown book) |
| `DELETE /api/shelf/mine/{book_id}` | Remove |
