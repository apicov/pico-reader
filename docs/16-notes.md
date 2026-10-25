# 16 — Notes

Notes are Markdown documents a reader keeps: summaries, outlines, study sheets, diagrams. They're private: nobody
else sees them.

## Making one

Ask in the chat, e.g. "summarise *Die Wolke* chapter by chapter as a note, with a map of the characters". The
agent searches the book, writes the note and proposes **Save note: …**. The card has **Show the note** (a preview)
and **Confirm** / **Cancel**; nothing is saved before confirming. "Add chapter 6 to my *Die Wolke* note" finds
the note and proposes **Add to note: …**, which appends a section.

Agent tools (`backend/app/agent_tools.py`): `list_notes`, `read_note` (run at once), `save_note`,
`append_to_note` (proposed, run after confirming). The agent never deletes or rewrites a note; the reader does
that in the app. The answer limit is 4,000 tokens, so a whole note fits in one call.

## Citations and diagrams

- A note's `[n]` point at passages. They're kept with the note (`notes.sources`), renumbered from 1 in the
  order they appear (appended sections continue the numbering), so a note keeps working after its chat is
  deleted. Tapping one opens the book at the passage.
- Diagrams are ```` ```mermaid ```` blocks (flowchart, mindmap, timeline, …), drawn by
  [mermaid](https://mermaid.js.org) in `frontend/src/components/diagrams.ts`. The library loads only when a text
  has a diagram; on the web it's fetched the first time one is shown and kept for offline use after that (the
  Android app has it built in). Diagrams keep their natural size and scroll sideways on a phone; colours follow the reading
  theme (Night turns them amber like everything else). A block that doesn't parse is shown as code with a note.
- Citations inside code (a diagram's `A[1]`) stay as they are.

## In the app

- **Notes** (top bar, `/notes`): every note, newest first. A note (`/notes/<id>`): ⋮ → **Edit** (title and
  Markdown, with a preview), **Export .md** (the cited passages are listed at the end; shared on Android, saved
  in the browser), **Delete…**.
- A book's page shows **My notes** about it.
- Offline: notes are kept on the device (IndexedDB) and read without a connection; changing one needs it.

## Limits and data

Table `notes` (migration 0016): id, reader, book (set to empty when the book is deleted), title, Markdown,
sources, times. At most 30,000 characters per note and 300 notes per reader (`backend/app/routes/notes.py`);
past them, saving fails with a message in the chat.

| Route | |
|---|---|
| `GET /api/notes` | The reader's notes (full), newest first; `?book=<id>` for one book's |
| `GET /api/notes/{id}` | One note |
| `PATCH /api/notes/{id}` | `{title?, markdown?}` |
| `DELETE /api/notes/{id}` | Remove |
