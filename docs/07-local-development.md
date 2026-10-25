# 07 — Local development

## Database

One container for development and tests:

```bash
podman run -d --name pico-reader-db -e POSTGRES_USER=reader -e POSTGRES_PASSWORD=reader \
    -e POSTGRES_DB=reader -p 127.0.0.1:5440:5432 docker.io/pgvector/pgvector:pg16
podman exec pico-reader-db createdb -U reader reader_test
```

## Backend

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # set SECRET_KEY; R2 keys only for real uploads/downloads
.venv/bin/alembic upgrade head
.venv/bin/python -m app.cli add you@example.com "You" --admin
.venv/bin/uvicorn app.main:app --reload --port 8030
```

Without an email key and with `ENVIRONMENT=development`, sign-in codes are printed in the backend's log.

**Tests** (database `reader_test`, which they wipe; R2 is faked with a moto S3 server):

```bash
.venv/bin/pytest
```

## Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173, /api proxied to localhost:8030
npm test
npx tsc -b                    # type check, as the build does
```

`VITE_PROXY_TARGET=https://books.apicov.xyz npm run dev` runs the local frontend against the live API.

## Testing

| What | Command | Covers |
|---|---|---|
| Backend | `cd backend && .venv/bin/pytest` | Every route against a real Postgres (`reader_test`) and moto for R2; the chat with a fake model |
| Backend coverage | `.venv/bin/pytest --cov=app` | Line coverage per module |
| Frontend | `cd frontend && npm test` | Services and helpers (vitest, jsdom, `fake-indexeddb`): the offline queues, sync, the book cache, offline search, notes |
| Frontend coverage | `npm run coverage` | Summary in the terminal, details in `frontend/coverage/index.html` |
| End to end | `e2e/run.sh` (about a minute) | The built web app in Chromium against a local backend: sign-in, My shelf, opening an EPUB and highlighting, a bookmark made offline, the night theme, a note from the chat |

`e2e/run.sh` needs the dev database container running. It makes a throwaway database, starts moto for R2, a
fake AI (`e2e/fake_ai.py`, replaying the answers a test queues), the API and the built web app on ports
8041–8044, seeds a reader and an EPUB (`e2e/seed.py`), runs `e2e/tests/` and removes it all again. Its own
virtualenv (`e2e/.venv`, Playwright) is made on the first run; it uses the system Chromium
(`E2E_CHROMIUM` to point elsewhere). Options go to pytest (`e2e/run.sh -k notes`); `KEEP_LOGS=1` keeps the
servers' logs.

The offline queues (highlights, review cards, the shelf, reading events) share one rule
(`frontend/src/services/syncQueue.ts`): an item the server refuses for good (a 4xx other than 401, 408, 429) is
dropped from the queue with a warning, so it can't block the changes after it; network errors and 5xx keep it
for the next try.
