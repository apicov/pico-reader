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
| `R2_ACCOUNT_ID` | `7e0d7635ec1403cb200c1af7fccb814b` (the account with the bucket, [01](01-cloudflare.md)) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | the bucket token ([01](01-cloudflare.md) §2) |
| `R2_BUCKET` | `pico-library` |
| `EMAIL_PROVIDER` | `cloudflare` |
| `EMAIL_FROM` | `noreply@thestitchpatterns.store` (an onboarded sending domain) |
| `CLOUDFLARE_EMAIL_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the Email Sending token and its account ([01](01-cloudflare.md) §4) |
| `GROQ_API_KEY` | Groq API key (console.groq.com → API Keys): translations, definitions, the chat, search, categories |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` (follows the JSON reply format reliably and translates well; `openai/gpt-oss-120b` also works) |
| `GROQ_AGENT_MODEL` | the chat agent's model (tool calling); empty = `GROQ_MODEL`. Qwen 3.8 calls several tools at once and answers well |

**The AI: Groq, Gemini or Claude.** `LLM_PROVIDER` picks the provider for translations, definitions, the chat,
search and categories (`backend/app/groq_client.py`):

| `LLM_PROVIDER` | Settings | Notes |
|---|---|---|
| `groq` (default) | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_AGENT_MODEL` (above) | OpenAI-compatible API |
| `gemini` | `GEMINI_API_KEY` (aistudio.google.com → Get API key), `GEMINI_MODEL` (default `gemini-3.5-flash`), `GEMINI_AGENT_MODEL` (empty = `GEMINI_MODEL`), `GEMINI_REASONING_EFFORT` (default `low`) | See below |
| `anthropic` | `ANTHROPIC_API_KEY` (platform.claude.com → API keys), `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `ANTHROPIC_AGENT_MODEL` (empty = `ANTHROPIC_MODEL`), `ANTHROPIC_EFFORT` (`low` … `max`; empty = the model's default) | See below |

- **Gemini:** Google's OpenAI-compatible endpoint, so it runs the same code as Groq.
  - Gemini 3 always thinks. `low` keeps that short, and calls get room in `max_tokens` for it.
  - If the endpoint refuses JSON mode, the request is sent again without it; the app reads the JSON object from the
    answer text.
  - The free tier has small per-minute and per-day limits (see AI Studio). Going over them gives 429, which the app
    shows as "too many requests".
- **Claude:** the official `anthropic` SDK (`backend/app/anthropic_llm.py`). It converts the chat's messages and
  tools to the Messages API and back.
  - **Thinking:** Claude thinks before answering; calls get room in `max_tokens` for it. In a chat step, its blocks
    (thinking included) are passed back unchanged.
  - **Refusals:** a request the safety classifiers decline is retried on Anthropic's recommended fallback model
    (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). If that declines too, the reader sees
    "Claude declined to answer this".

**A fallback for when the first is unavailable.** `LLM_FALLBACK_PROVIDER` (`groq`, `gemini` or `anthropic`) names a
second AI. It can be another provider, or the same one with another key or model:
- **Its own settings:** `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL` and `LLM_FALLBACK_AGENT_MODEL`. Empty ones take
  that provider's own settings. Example: two Gemini free-tier keys, the second as the fallback:
  `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=<first>`, `LLM_FALLBACK_PROVIDER=gemini`, `LLM_FALLBACK_API_KEY=<second>`.
- **When it's used:** the first is unavailable. That means a limit (429), overload or a server error (5xx), a call
  longer than `LLM_TIMEOUT` (default 45 s), no connection, a missing key, or a key or model the provider no longer
  accepts (401/403/404). A bad request or a refusal isn't retried elsewhere.
- **Resting:** after a failure the first provider is left out as long as it asked to be (`retry-after`), or a minute
  after a limit, half a minute otherwise. Then it's tried first again.
- **In the chat:** an answer can continue on the fallback between two steps.
  - Each step keeps which route wrote it (`_route`), so each provider gets the others' tool calls in a form it
    takes.
  - Gemini needs a thought signature on every earlier tool call. For calls it didn't make, it gets Google's
    placeholder (`skip_thought_signature_validator`).
  - Claude gets the calls without Gemini's extra fields; Groq gets them without Claude's blocks.
- **Where to see it:** the log says when and why the fallback was used. AI usage on the statistics page lists the
  model of each call.

Switching providers: set the variables in `reader.env` and restart both services. Translations made before keep
the model that wrote them; asking again for the same passage translates it anew with the new model. AI usage on
the statistics page lists the model of each call.

Optional: `TOKEN_DAYS` (sign-in lifetime, default 365: the app reads offline and shouldn't log you out),
`DOWNLOAD_URL_SECONDS` / `UPLOAD_URL_SECONDS` (signed link lifetime, default 3600),
`EMAIL_FROM_NAME` (default `Pico Reader`), `EMAIL_FALLBACK_PROVIDER=brevo` with `BREVO_API_KEY`,
`GROQ_REASONING_FORMAT` (default `hidden`; empty = not sent), `GROQ_BASE_URL` (default Groq's OpenAI-compatible
API), `PICO_READER_MODELS` (where the search model is kept, default `~/.cache/pico-reader/models`),
`EMBED_THREADS` (embedding threads; the indexer's unit sets 1).

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
