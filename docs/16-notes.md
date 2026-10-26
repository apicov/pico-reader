# 16 — Notes

Notes are Markdown documents a reader keeps: summaries, outlines, study sheets, diagrams. They're private: nobody
else sees them.

## Making one

Ask in the chat, e.g. "summarise *Die Wolke* chapter by chapter as a note, with a map of the characters". The
agent searches the book, writes the note and proposes **Save note: …**. The card has **Show the note** (a preview)
and **Confirm** / **Cancel**; nothing is saved before confirming. "Add chapter 6 to my *Die Wolke* note" finds
the note and proposes **Add to note: …**, which appends a section.

Agent tools (`backend/app/agent_tools.py`): `list_notes`, `read_note` (run at once), `save_note`,
`append_to_note` (proposed, run after confirming). `list_notes` names the reader's projects and filters by one;
`save_note` can put the note into a project ("…as a note in my rust-book project"). The agent never deletes or rewrites a note; the reader does
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

- **Notes** (top bar, `/notes`): every note, newest first. With projects ([17](17-computer-sync.md#projects)),
  chips filter them: *All · a project (n) … · No project* (remembered).
- **A note** (`/notes/<id>`), ⋮ menu:
  - **Edit**: title and Markdown, with a preview.
  - **Project…**: moves the note to a project, or out of it; on the computer its file moves along.
  - **Export .md**: the cited passages are listed at the end; shared on Android, saved in the browser.
  - **Send to computer (copy)**.
  - **Delete…**.
- **Live:** an open note follows changes made elsewhere, for example in its `.md` file on the computer. Every 4
  s while it's on screen and not being edited, it shows the new version ("Updated just now").
- **Saving over a newer version:** if the note changed meanwhile, the app asks: **Take theirs**, or
  **Save mine** over it (`updated_at_was`, 409).
- A book's page shows **My notes** about it.
- Offline: notes are kept on the device (IndexedDB) and read without a connection; changing one needs it.

## Limits and data

Table `notes` (migration 0016): id, reader, book (set to empty when the book is deleted), title, Markdown,
sources, times. Later: `origin` (`chat`, `app`, `computer`; 0018), `project_id` (0019). At most 30,000 characters per note and 300 notes per reader (`backend/app/routes/notes.py`);
past them, saving fails with a message in the chat.

| Route | |
|---|---|
| `GET /api/notes` | The reader's notes (full), newest first; `?book=<id>` for one book's |
| `GET /api/notes/{id}` | One note |
| `POST /api/notes` | A new note `{title, markdown, book_id?, origin?, project_id?}` |
| `PATCH /api/notes/{id}` | `{title?, markdown?, project_id?, updated_at_was?}` (409 when it changed meanwhile) |
| `DELETE /api/notes/{id}` | Remove |
