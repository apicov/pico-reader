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
