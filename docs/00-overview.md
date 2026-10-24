# 00 — Overview

A personal e-book reader for a private library: PDF, EPUB and Markdown books ("mdbooks"), readable offline
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
| `books/<book id>/<kind>-<hash>.<ext>` | a book's files: `pdf`, `epub`, `mdbook` (zip), `cover` (image) |
| `dictionaries/<dict id>/<kind>-<hash>.<ext>` | `sqlite` (Android), `jsonl.gz` (web), `res` zip (images) |
| `backups/reader-YYYYMMDD.sql.gz` | daily database dumps, 30 days |

The hash in a file name changes whenever the file does, so a replaced file never comes from a stale cache.

## How a book reaches a device

1. The desktop tool asks `POST /api/admin/books` for upload links, PUTs the files straight to R2, then calls
   `/commit`; the backend checks every file is in the bucket with the right size and lists the book.
2. The app loads `GET /api/library` (cached for offline use, revalidated with an ETag).
3. Opening a book asks `GET /api/books/<id>/download?kind=…` for a signed link (valid one hour) and
   downloads the file from R2 into the device's storage.
