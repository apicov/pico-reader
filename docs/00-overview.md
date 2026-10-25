# 00 — Overview

A personal e-book reader for a private library: PDF, EPUB and reflowable text books (Quarto HTML or Markdown chapters in a zip, see `tools/README.md`), readable offline
on Android and in the browser, with offline dictionaries and AI translation of selected text.

## Parts

```
desktop tool (tools/) ──signed PUT──▶ R2 bucket pico-library (private)
      │ POST /api/admin/…                    ▲ signed GET
      ▼                                      │
Apache (books.apicov.xyz, HTTPS) ──/api──▶ FastAPI (systemd pico-reader, :8030) ── Postgres+pgvector (docker, :5440)
      │ static files
      ▼
web app / PWA  ·  Android app (Capacitor, same build)
```

- **Backend** (`backend/`): FastAPI. Email-code sign-in for an allowlist of readers, the library list,
  short-lived signed links to files in R2, uploads from the desktop tool, reading positions synced between
  devices. It never streams book files: devices download straight from R2.
- **Database**: Postgres 16 with the pgvector extension, in its own container, only reachable on localhost.
- **Files**: the private R2 bucket `pico-library`. Nobody reaches a file without a link the backend signed
  after checking the sign-in.
- **Frontend** (`frontend/`): React + MUI + Vite, wrapped by Capacitor for Android. The same build is the web
  app (installable PWA). Downloaded books stay on the device for offline reading.
- **Email**: sign-in codes go out through Cloudflare Email Sending.
- **Groq**: translates selected passages (stored per reader in `translations`) and answers questions about
  the library from its passages (`/api/ask`).
- **Highlights and bookmarks** (`annotations`): made offline on each device with its own ids, pushed and
  pulled when online; the newest edit wins and deletions are kept as tombstones so every device learns of them.
- **Vocabulary export**: `/api/vocabulary.apkg` (an Anki deck, genanki) and `/api/vocabulary.tsv`, from the
  vocabulary of saved translations.
- **Chats** ("Ask your library"): `conversations` and `messages` in Postgres (so in the daily backup). The
  chat is an agent (`backend/app/agent_tools.py`): with the recent turns and a list of every book, the model
  calls fixed tools (book passages, reading and lookup statistics, translations, highlights, review cards,
  the reading goal, book links, the Anki export, notes, My shelf and its collections, community posts with
  their comments, the reader's reviews; spoilers stay hidden) and answers with citations. Tools that change something
  (goal, known words, review cards, saving a note) are only proposed; they run when the reader confirms
  (`chat_actions`).
- **Notes** ([16](16-notes.md)): private Markdown documents with citations and Mermaid diagrams, written by the
  agent on request (`notes`).
- **The study computer** ([17](17-computer-sync.md)): highlights, code and notes sent from the app (or by the
  agent) wait in `drops` until the desktop tool (`reader sync`) writes them into a folder; files saved there
  become notes, and Notes are kept there as `.md` files both ways.
  Turns stream as server-sent events (Apache passes them through with `flushpackets=on`).
- **Uploads and indexing** ([10](10-uploads-and-offline-search.md)): any reader adds books from the app;
  `book_events` keeps who uploaded, changed or deleted what and when; `index_jobs` + the
  `pico-reader-indexer` service make uploaded books searchable and write each book's offline search file.
- **Community** ([11](11-community.md)): profiles, 0–10 reviews with "recommend", posts linked to books with
  quotes that open the reader at the passage, comments with one level of replies, likes and top lists. Everyone
  signed in sees everything; other readers are shown by handle, never by email. Admins can hide anything.
- **Dictionaries** ([12](12-dictionaries.md)): each is for every reader or only its uploader (admins see all);
  admins upload StarDict from the app (converted by the indexer service) or the desktop tool; readers install
  them per device and switch them on/off and order them for their account (`reader_settings.dictionaries`).
- **Categories** ([13](13-categories.md)): a shared 3-level tree; the AI files each book after indexing (new
  categories only under existing ones, approved by an admin); the uploader or an admin can change it.
- **AI usage** (`llm_usage`): every Groq call records its reader, purpose (translate, define, chat, chat_title,
  search, ask), model and tokens in and out (`groq_client._record`). Readers see their own on the statistics
  page and through the agent; `python -m app.cli usage` lists everyone's.
- **Statistics** (`reading_sessions`, `lookups`, recorded on the device and sent in batches; `reader_settings`
  for the optional reading goal): `/api/stats` gives minutes per day, streaks, goal days, reading speed, time
  left per book, a weekday × hour heatmap, lookups per 1,000 words read, repeated and missing words.
- **Learning**: `known_words`; `review_cards` scheduled on the device with FSRS (ts-fsrs) and synced like
  annotations; words looked up before are underlined while reading; `/api/define` asks the model for a word
  no offline dictionary has.
- **Search**: book passages with embeddings (pgvector) and full-text vectors in `book_chunks`, built by the
  server's indexer for books uploaded from the app, or on the desktop (`reader index`) for big batches; the
  backend embeds questions with the same small model (~135 MB, loaded on the first search). A question is first translated (Groq) into the languages of the indexed books, and every
  version is searched, because the small model matches best within one language.

## Names and addresses

| What | Value |
|---|---|
| Web app and API | `https://books.apicov.xyz` (API under `/api`, health check `/health`) |
| Server | Linode `172.104.159.186`, Fedora Server, user `tsp` |
| Code on the server | `/home/tsp/code/pico-reader` |
| Settings and secrets | `/etc/pico-reader/reader.env` (linked as `backend/.env`) |
| Backend service | systemd `pico-reader`, uvicorn on `127.0.0.1:8030` |
| Database | docker container `pico-reader-db`, `127.0.0.1:5440`, database and role `reader`, volume `pico-reader-pg` |
| Web root | `/var/www/pico-reader` |
| Apache config | `/etc/httpd/conf.d/books-http.conf`, `books-https.conf` |
| R2 | account `c10b6d4948424c31eab1b0cd8137caa2`, bucket `pico-library` |
| DNS | `apicov.xyz` at Namecheap (Namecheap nameservers) |
| Android app id | `xyz.apicov.reader` |

## What is in the bucket

| Key | Content |
|---|---|
| `books/<book id>/<kind>-<hash>.<ext>` | a book's files: `pdf`, `epub`, `reflow` (zip), `cover` (image) |
| `dictionaries/<dict id>/<kind>-<hash>.<ext>` | `sqlite` (Android), `jsonl.gz` (web), `res` zip (images) |
| `backups/reader-YYYYMMDD.sql.gz` | daily database dumps, 30 days |

The hash in a file name changes whenever the file does, so a replaced file never comes from a stale cache.

## How a book reaches a device

1. The desktop tool asks `POST /api/admin/books` for upload links, PUTs the files straight to R2, then calls
   `/commit`; the backend checks every file is in the bucket with the right size and lists the book.
2. The app loads `GET /api/library` (cached for offline use, revalidated with an ETag).
3. Opening a book asks `GET /api/books/<id>/download?kind=…` for a signed link (valid one hour) and
   downloads the file from R2 into the device's storage.
