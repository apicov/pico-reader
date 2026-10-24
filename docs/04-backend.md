# 04 — Backend

The API (FastAPI under uvicorn, run by systemd) and its database (Postgres with pgvector, in Docker).
Commands run as root unless they start with `sudo -u tsp` or say "as tsp".

## 1. Database

```bash
DB_PASSWORD=$(openssl rand -hex 24)     # goes into DATABASE_URL below
docker run -d --name pico-reader-db --restart unless-stopped \
    -e POSTGRES_USER=reader -e POSTGRES_PASSWORD=$DB_PASSWORD -e POSTGRES_DB=reader \
    -v pico-reader-pg:/var/lib/postgresql/data -p 127.0.0.1:5440:5432 \
    docker.io/pgvector/pgvector:pg16 -c shared_buffers=32MB -c max_connections=20
```

The data lives in the Docker volume `pico-reader-pg`. `--restart unless-stopped` brings the container back
after a reboot (Docker itself is enabled in [03](03-server.md)). The small `shared_buffers` and connection
limit keep it light on a 2 GB box.

## 2. Code

The repository goes to `/home/tsp/code/pico-reader`. From a workstation checkout:

```bash
ssh root@<ip> 'mkdir -p /home/tsp/code/pico-reader'
git archive HEAD | ssh root@<ip> 'cd /home/tsp/code/pico-reader && tar x && chown -R tsp:tsp .'
```

(With a git remote, `git clone` as tsp works as well.)

## 3. Python environment

As tsp:

```bash
cd ~/code/pico-reader/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

systemd may only start programs labelled `bin_t`, and a home folder isn't. Label the virtualenv once,
persistently:

```bash
semanage fcontext -a -t bin_t "/home/tsp/code/pico-reader/backend/.venv/bin(/.*)?"
restorecon -R /home/tsp/code/pico-reader/backend/.venv/bin
```

## 4. Settings

One file, `/etc/pico-reader/reader.env`, readable by root and the `tsp` group only. systemd reads it into the
service's environment; `backend/.env` is a link to it, so the CLI, alembic and the backup read the same file.
It lives in `/etc` because SELinux doesn't let systemd read files in a home folder.

```bash
install -d -m 750 -o root -g tsp /etc/pico-reader
install -m 640 -o root -g tsp /dev/null /etc/pico-reader/reader.env
ln -sfn /etc/pico-reader/reader.env /home/tsp/code/pico-reader/backend/.env
```

Content (template: `backend/.env.example`). One `NAME=value` per line, no comments after values (systemd would
make them part of the value):

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` (sign-in codes are never written to the log) |
| `SECRET_KEY` | `openssl rand -hex 32`; signs the sign-in tokens. Changing it signs everyone out |
| `DATABASE_URL` | `postgresql+psycopg://reader:<DB_PASSWORD>@127.0.0.1:5440/reader` |
| `CORS_ORIGINS` | `https://books.apicov.xyz,http://localhost:5173,https://localhost,capacitor://localhost` |
| `R2_ACCOUNT_ID` | `c10b6d4948424c31eab1b0cd8137caa2` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | the bucket token ([01](01-cloudflare.md) §2) |
| `R2_BUCKET` | `pico-library` |
| `EMAIL_PROVIDER` | `cloudflare` |
| `EMAIL_FROM` | `noreply@thestitchpatterns.store` (an onboarded sending domain) |
| `CLOUDFLARE_EMAIL_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the Email Sending token and its account ([01](01-cloudflare.md) §4) |
| `GROQ_API_KEY` | Groq API key (console.groq.com → API Keys), for translations |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` (follows the JSON reply format reliably and translates well; `openai/gpt-oss-120b` also works) |
| `GROQ_AGENT_MODEL` | the chat agent's model (tool calling); empty = `GROQ_MODEL`. Qwen 3.8 calls several tools at once and answers well |

Optional: `TOKEN_DAYS` (sign-in lifetime, default 365: the app reads offline and shouldn't log you out),
`DOWNLOAD_URL_SECONDS` / `UPLOAD_URL_SECONDS` (signed link lifetime, default 3600),
`EMAIL_FROM_NAME` (default `Pico Reader`), `EMAIL_FALLBACK_PROVIDER=brevo` with `BREVO_API_KEY`.

Keep a copy of the file in `~/tsp-configs/pico-reader/reader.server.env` on your workstation.

## 5. Schema

As tsp:

```bash
cd ~/code/pico-reader/backend
.venv/bin/alembic upgrade head
```

Migrations are in `backend/alembic/versions/`; run the same command after every update that adds one.

Search needs the embedding model on the server (~135 MB, kept in `~/.cache/pico-reader/models` of `tsp`).
Fetch it once, so the first search doesn't wait for the download:

```bash
.venv/bin/python -c "from app import embed; embed.embed(['test'], 'query')"
```

## 6. Service

```bash
cp /home/tsp/code/pico-reader/deploy/pico-reader.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pico-reader
curl -s 127.0.0.1:8030/health        # {"status":"ok"}
```

The unit runs uvicorn as tsp on `127.0.0.1:8030` with one worker (enough for one reader, and light on memory).

## 6b. Indexer

Books added from the app are indexed, and StarDict dictionaries uploaded from the app converted, by a second
service with the same code and settings ([10](10-uploads-and-offline-search.md), [12](12-dictionaries.md)):

```bash
cp /home/tsp/code/pico-reader/deploy/pico-reader-indexer.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pico-reader-indexer
journalctl -u pico-reader-indexer -f          # "Indexed <book>: N passages …", "Converted dictionary …"
```

It runs with one embedding thread and a lower priority (`Nice=10`), so the API stays responsive. It also
unloads the model after 5 idle minutes.

## 7. Who can sign in

Only emails on the allowlist get a sign-in code. As tsp, in `backend/`:

```bash
.venv/bin/python -m app.cli add you@example.com "Your Name" --admin   # admins can add books
.venv/bin/python -m app.cli list
.venv/bin/python -m app.cli remove someone@example.com                # locked out at once
.venv/bin/python -m app.cli usage --days 30                          # Groq tokens per reader and purpose
```

## 8. Backups

`deploy/backup-db.sh` dumps the database, keeps 14 days in `/home/tsp/backups/pico-reader/` and uploads each
dump to R2 (`backups/`, 30 days, `app/offsite_backup.py`). Run it daily from tsp's crontab (`crontab -e` as tsp):

```cron
30 3 * * * /home/tsp/code/pico-reader/deploy/backup-db.sh >> /home/tsp/pico-reader-backup.log 2>&1
```

Run it once by hand to check it: `~/code/pico-reader/deploy/backup-db.sh`. Restoring is in
[08](08-operations.md).
