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

`reader sync --once` does one round; `reader sync` keeps going (every 15 s, `--interval`); `--folder` picks
another folder than `~/pico`; `--uninstall` removes the service.

## The folder

| Folder | Direction | What |
|---|---|---|
| `inbox/` | app → computer | What you send: highlights and notes as Markdown with front matter (`book`, `where`: chapter and %, `sent`); **code** as a source file (`.py`, `.rs`, … from the code block's language, `.txt` when it doesn't say) with a comment header naming the book and place. Names: `2026-10-25 1412 <book> – highlight.md`; never overwritten |
| `outbox/` | computer → app | A `.md` / `.txt` saved here becomes a note (title: the file name, or `title:` in front matter), then moves to `outbox/sent/`. Files younger than 2 s wait for the next round (still being written) |
| `notes/` | both | Your Notes as `<title>.md`: front matter `id`, `title`, `book`, `updated`, then the Markdown. Edit freely; the title comes from `title:` |

**Notes rules:**
- A new file in `notes/` (no `id`) becomes a note and gets its `id` written into it.
- Deleting a file doesn't delete the note: it's written again next round. Delete notes in the app; then the
  file moves to `notes/deleted/`.
- A note's sources are listed at the end below `<!-- sources from the app: … -->`; that part isn't sent back.
- Changed on both sides since the last round: the app's version is written, yours is kept in
  `notes/conflicts/<title> (conflict <date>).md`. The server checks too (`updated_at_was`, 409), so an edit
  in the app during a round isn't lost either.
- What was synced last is in `~/.local/state/pico-reader/sync.json` (per folder).

## Sending from the app

- **Selected text** → the computer button: code (selected inside a code block) goes as a snippet with its
  language; anything else as a highlight with the book, chapter and place.
- **A highlight** in the contents drawer (Notes tab) → the computer button.
- **A note** → ⋮ → *Send to computer (copy)* (notes are in `notes/` anyway; this puts a copy in the inbox).
- **The chat agent**: "send the code from chapter 3 to my computer" → *Send to your computer: …* with a preview;
  sent after you confirm (`send_to_computer`).
- Offline it's queued and sent when the connection is back. Settings → *Computer* shows when the computer last
  synced and how much waits for it.

## Server

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
| `POST /api/notes` | A new note (`origin`: `app` or `computer`) |
| `PATCH /api/notes/{id}` | With `updated_at_was`: 409 when the note changed meanwhile |

## Troubleshooting

- *Not signed in*: `reader login` again (the token lasts a year).
- Nothing arrives: `journalctl --user -u pico-reader-sync`; Settings → Computer shows whether it synced lately.
- A file in `outbox/` stays: it must be `.md`, `.markdown` or `.txt` and not empty.
