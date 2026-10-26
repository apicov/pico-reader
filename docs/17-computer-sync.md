# 17 — Sync with the study computer

For studying on a computer with only a terminal and an editor: things from the app arrive there as plain files,
and files saved there reach the app. The desktop tool does it (`reader sync`, [tools/README](../tools/README.md));
any reader can use it, not only admins.

## Setting it up (Linux)

```bash
cd tools && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
./reader login you@example.com                  # emails a code
./reader login you@example.com --code 123456
./reader sync --install                         # a systemd user service: starts with your session
journalctl --user -u pico-reader-sync -f        # what it does
```

`reader sync --once` does one round. `reader sync` keeps going:
- **A file saved here** (a note, an outbox file) starts a round as soon as it has settled (2 s), so an edit
  reaches the app within a few seconds.
- **The server** is asked every 5 s (`--interval`). That one small call (`GET /api/computer/poll`) returns what
  waits for the inbox, plus a stamp of the notes. The notes themselves are fetched only when that stamp changed.

`--folder` picks another folder than `~/pico`; `--uninstall` removes the service. The service's log reaches
`journalctl` as it happens (`PYTHONUNBUFFERED`).

## Projects

A project is a folder on the computer, e.g. `~/code/rust-book`, with its own `notes/` and `inbox/`. Everything
for that project stays in its folder.

```bash
cd ~/code/rust-book
reader project add                 # this folder becomes the project “rust-book” (--name to call it otherwise)
reader project list                # the projects, and where each is on this computer
reader project remove [--delete]   # stop syncing this folder (its files stay); --delete: also in the app
```

- **Picking it up:** the running sync sees a new project at its next round; no restart is needed.
- **Linking an existing project:** if the app already has a project of that name (made on another computer),
  the folder is linked to it.
- **Where the links are kept:** in `~/.config/pico-reader/projects.json`.
- **Where a note's file lives:**
  - in its project's `notes/`, when that project is on this computer;
  - otherwise in `~/pico/notes`.
- **Moving notes:** moving a note to another project in the app (⋮ → *Project…*) moves its file. Moving the
  file between those folders (`mv`, the file manager) moves the note to that project in the app.
- **New notes:** a new file in a project's `notes/` becomes a note in that project.
- **Removing a project:** `reader project remove --delete` removes it in the app. Its notes stay, now in no
  project, so their files come back to `~/pico/notes`.
- **Sending:** in the app, *Send to computer* asks where to: the inbox, or one of the projects. The last choice
  comes first. What goes to a project lands in its `inbox/`. If the project isn't on this computer, it lands in
  `~/pico/inbox`.
- **Notes in the app:** they can be filtered by project (chips above the list), and a note shows its project.

## The folder

| Folder | Direction | What |
|---|---|---|
| `inbox/` | app → computer | What you send: highlights and notes as Markdown with front matter (`book`, `where`: chapter and %, `sent`); **code** as a source file (`.py`, `.rs`, … from the code block's language, `.txt` when it doesn't say) with a comment header naming the book and place. Names: `2026-10-25 1412 <book> – highlight.md`; never overwritten. Or, sent to the **running file**: added to the end of `inbox/journal.md` |
| `outbox/` | computer → app | A `.md` / `.txt` saved here becomes a note (title: the file name, or `title:` in front matter), then moves to `outbox/sent/`. Files younger than 2 s wait for the next round (still being written) |
| `notes/` | both | Your Notes that are in no project, as `<title>.md`: front matter `id`, `title`, `book`, `updated`, then the Markdown. Edit freely; the title comes from `title:` |

**Notes rules:**
- A new file in `notes/` (no `id`) becomes a note and gets its `id` written into it.
- Deleting a file doesn't delete the note: it's written again next round. Delete notes in the app; then the
  file moves to `notes/deleted/`.
- A note's sources are listed at the end below `<!-- sources from the app: … -->`; that part isn't sent back.
- Changed on both sides since the last round: the app's version is written, yours is kept in
  `notes/conflicts/<title> (conflict <date>).md`. The server checks too (`updated_at_was`, 409), so an edit
  in the app during a round isn't lost either.
- What was synced last is in `~/.local/state/pico-reader/sync.json` (per folder).

**In the app**, an open note follows changes made elsewhere: every 4 s while it's on screen and not being
edited, it shows the new version ("Updated just now"). If you save an edit in the app while the file changed
meanwhile, the app says so and lets you choose: *Take theirs*, or *Save mine* over it.

## Sending from the app

*Send to computer* opens a small dialog with two choices, both remembered:
- **How:**
  - **Running file**: the item is added to the end of that inbox's `journal.md`. Keep that one file open in the
    editor and everything you send arrives there, in order, the newest at the end. Each item gets a heading
    line (`## 2026-10-26 14:12 · Fluent Python · 2 Lists · code (python)`), then the text: a highlight as a
    quote, code fenced with its language.
  - **New file**: a file of its own, as below.
- **Where:** the inbox, or one of your projects.

Editors reload a file changed on disk when you come back to it. In Vim/LazyVim that's `autoread` (on in
LazyVim), or `:checktime` to reload now. Don't keep unsaved edits in `journal.md`: saving them would overwrite
what arrived meanwhile (Vim warns about it first).

- **Selected text** → the computer button: code (selected inside a code block) goes as a snippet with its
  language; anything else as a highlight with the book, chapter and place.
- **A highlight** in the contents drawer (Notes tab) → the computer button.
- **A note** → ⋮ → *Send to computer (copy)* (notes are in `notes/` anyway; this puts a copy in the inbox).
- **The chat agent**: "send the code from chapter 3 to my computer" → *Send to your computer: …* with a preview;
  sent after you confirm (`send_to_computer`).
- Offline it's queued and sent when the connection is back. Settings → *Computer* shows when the computer last
  synced and how much waits for it.

## Server

Table `projects` (id made by the tool, `proj-…`; name unique per reader, at most 50). `notes.project_id` and
`drops.project_id` point to it; deleting a project leaves its notes and drops in none.

Table `drops`: a per-reader mailbox (kind `highlight|snippet|note|text`, title, language, body up to 200 KB,
meta with book, chapter, place). At most 500 wait per reader; delivered ones are deleted after 30 days.
`computers` records when the tool last collected. `notes.origin` says where a note was made (`chat`, `app`,
`computer`); the agent sees it.

| Route | |
|---|---|
| `POST /api/drops` | Send (`id` from the device makes a resend harmless) |
| `GET /api/drops` | What waits, oldest first (records the computer's visit) |
| `POST /api/drops/{id}/delivered` | Written to the inbox |
| `GET /api/computer` | `{seen_at, waiting}` |
| `GET /api/computer/poll` | The tool's call every few seconds: `{drops, projects, notes_stamp}` (records the visit) |
| `GET /api/projects` | `[{id, name, notes}]` |
| `PUT /api/projects/{id}` | Create or rename `{name}` (409: the name is taken) |
| `DELETE /api/projects/{id}` | Its notes stay, in no project |
| `POST /api/notes` | A new note (`origin`: `app` or `computer`; `project_id`) |
| `PATCH /api/notes/{id}` | With `updated_at_was`: 409 when the note changed meanwhile. `project_id` (also null) moves it |

## Troubleshooting

- *Not signed in*: `reader login` again (the token lasts a year).
- Nothing arrives: `journalctl --user -u pico-reader-sync`; Settings → Computer shows whether it synced lately.
- A file in `outbox/` stays: it must be `.md`, `.markdown` or `.txt` and not empty.
- A project's notes don't appear in its folder: `reader project list` shows whether that folder is linked on this
  computer.

The chat agent knows the projects too: `list_notes` names them and filters by one, and `save_note` and
`send_to_computer` take a `project`.
