# 12 Dictionaries

StarDict dictionaries, converted into packages the devices install, so looking up a word works offline.

## Where they are

| | Where |
|---|---|
| The packages | R2, `dictionaries/<id>/`: `sqlite-….zip` (Android), `jsonl-….jsonl.gz` (web), `res-….zip` (images) |
| The list | Postgres `dictionaries` (name, languages, entries, files, `visibility`, `uploaded_by`) |
| Installed copies | Each device: SQLite databases on Android, IndexedDB in the browser |
| Which are on, their order | The reader's account: `reader_settings.settings.dictionaries` = `{disabled: [ids], order: {lang: [ids]}}` |

## The Dictionaries page (Settings → Manage dictionaries)

- **On this device**: how many are installed and the space they take.
- Per language: **Install all** / **Remove all**; per dictionary **Install**, **Update** (a newer package on the
  server), **Remove**.
- Installed ones have a **switch** (used for lookups or not) and **↑/↓** (the order in the dictionary sheet).
  Both are saved to the account, so every device of the reader uses the same; changed offline, they're sent
  later. The ★ in the dictionary sheet moves a dictionary to the top.
- **No longer available**: installed here but gone from the library (deleted, or made private by someone
  else); remove to free the space.

## The Dictionary page (top bar, `/#/dictionary`)

Looking up without a book, GoldenDict style: a language, a word (headwords starting the same are suggested
from the installed dictionaries as you type), the same results as the dictionary sheet in a book. When no
dictionary has the word and the device is online, `POST /api/define` is asked twice in parallel, without a
sentence: `target_lang` = the reader's language (a translation) and `target_lang` = the word's language (a
monolingual definition; the prompt changes when the two are equal). The address keeps `lang` and `w`, so back
and forward go through the words; `?tab=history` is the translations list (`/#/translations` redirects there).
Lookups are recorded like a book's, with no `book_id`: they count in the statistics, but not in the lookups
per 1000 words read.

## Who sees which

A dictionary is for **every reader**, or **only its uploader**. Admins see all. Readers never learn who
uploaded one. A hidden dictionary is left out of the library list, and its download links answer 404.
Dictionaries added before this existed have no uploader; making one private makes the admin who did it its
owner.

Admins change it on the page (⋮ → *Make it only mine* / *Share with every reader*), or with the desktop tool:
`reader dict-add <folder> --from de --to de --private` (or `--public`; an update without either keeps the
setting).

## Uploading from the app (admins)

Dictionaries page → **Upload** → choose the StarDict files (`.ifo`, `.idx`/`.idx.gz`, `.dict`/`.dict.dz`,
optional `.syn` and a `res` folder of images), a folder, or a zip of them. The app reads the name and size from
the `.ifo`; choose the languages and who sees it (default: only you).

The app sends one zip (`source`) straight to R2 and the server queues a conversion (`dict_jobs`). The indexer
service ([04 §6b](04-backend.md)) takes it: it unzips, reads the dictionary (`app/stardict.py`, the same
converter as the desktop tool's `tools/readertool/stardict.py`; keep the two the same), writes the packages,
uploads them, lists the dictionary and deletes the `source` zip. Uploads up to 300 MB; the whole dictionary is
in memory while it's converted. A file that isn't a StarDict fails at once with the reason; other errors are
retried up to 3 times. The page shows *waiting / converting… / failed: reason* while it works.

Uploading again to the same id (the desktop tool does this by folder name) replaces the packages; devices then
offer **Update**.

## API

| Route | |
|---|---|
| `GET /api/library` | `dictionaries`: the ones the reader may see, with `visibility` and `can_change` |
| `GET /api/dictionaries/{id}/download?kind=sqlite\|jsonl\|res` | A signed link (404 if hidden from the reader) |
| `GET/PUT /api/settings` | `dictionaries: {disabled, order}`; a PUT saves only the parts it sends |
| `POST /api/admin/dictionaries/upload`, `POST /api/admin/dictionaries/{id}/convert` | App upload: signed PUT for the zip, then queue it |
| `GET /api/admin/dict-jobs` | Conversions waiting, running, failed in the last 7 days |
| `PUT /api/admin/dictionaries/{id}` | `name`, `from_lang`, `to_lang`, `visibility` |
| `POST /api/admin/dictionaries` + `/commit`, `DELETE /api/admin/dictionaries/{id}` | Desktop tool upload; delete |
