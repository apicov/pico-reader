# 18 — Workspaces

A **workspace** is a named set of books open at the same time, shown as tabs in the reader. Opening a book adds it
as a tab to the current workspace (or brings its tab to the front); it no longer replaces the book that was open.

## In the reader

- With two tabs or more (or more than one workspace), a row under the reader's bar shows the workspace's name and
  a tab per book (`frontend/src/reader/WorkspaceTabs.tsx`). Tapping a tab switches at once; × closes it, and
  closing the last one goes back to the Library. Switching replaces the address, so Back leaves the reader.
- The name opens the workspace menu: switch to another, **New workspace…** (it starts with the book being read),
  **Rename…**, **Delete workspace** (the books are untouched). The first workspace, made when a book is first
  opened, is called *Reading*.
- A workspace holds up to **8 books**; opening a ninth gives up the leftmost tab other than the one in front.
- **Loaded books:** up to **4** stay loaded behind the one shown (`components/ReaderHost.tsx`,
  `reader/loadedBooks.ts`): hidden at full size, so switching back lays nothing out again. Beyond 4, the one viewed
  longest ago is let go; its tab opens it again in about a second, at its place (positions are per book,
  [progress](../backend/app/routes/progress.py)). A PDF holds its whole file in memory, hence the limit.
- Books loaded together stay apart: each reflow book's CSS is scoped to its own class, a selection only counts in
  the book it's in (`watchSelection`'s `within`), and EPUB ignores keys while hidden.
- **At start:** if the app was closed while in a book (`reader_was_open`), it opens the current workspace's tab in
  front. The top bar's "Back to the book" button survives a restart too (`reader/readingNow.ts`, local storage).

## What's synced and what's per device

- **The account's** (table `workspaces`): each workspace's name, books and order. Kept on the device for offline
  use (`frontend/src/services/workspaces.ts`, pref `workspaces`); a change is applied at once and its id queued
  (`workspaces_pending`), and the latest state of each queued workspace is sent. Synced at start, every 3 minutes,
  when the connection is back, and right after a change when online.
- **The device's:** which workspace is open (`workspace_current`) and which tab is in front in each
  (`workspace_front:<id>`), so a phone and a tablet can be on different workspaces, and switching tabs writes
  nothing to the server.
- **Conflicts:** the device stamps each change; per workspace the newest stamp wins (as reading positions do), a
  device clock ahead of the server's is clamped to the server's time, and the device takes the time the server
  kept. A deleted workspace stays on the server as a tombstone, so no later change from another device brings it
  back. A device with no workspaces yet (just signed in) syncs before making a *Reading* one.

## API

| Route | |
|---|---|
| `GET /api/workspaces` | `[{id, name, book_ids, position, updated_at, deleted}]`, not deleted, in order |
| `PUT /api/workspaces/{id}` | `{name, book_ids, position, updated_at, deleted}`: create, change or delete; returns what the server keeps (the change, or a newer one) |

Ids are made on the device (`ws-<uuid>`). At most 50 workspaces per reader, 8 books each, names of 1–60
characters; a book listed twice is kept once. Another reader's workspace is "not found".
