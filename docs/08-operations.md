# 08 — Operations

## Deploying a change

From the workstation checkout, after committing:

```bash
git archive HEAD | ssh root@172.104.159.186 'cd /home/tsp/code/pico-reader && tar x && chown -R tsp:tsp .'
```

Then on the server, depending on what changed:

| Changed | Run |
|---|---|
| backend code | `systemctl restart pico-reader pico-reader-indexer` (the indexer runs the same code: indexing, dictionary conversion, categories) |
| `backend/requirements.txt` | as tsp in `backend/`: `.venv/bin/pip install -r requirements.txt`, then `restorecon -R .venv/bin` and restart both |
| a migration | as tsp in `backend/`: `.venv/bin/alembic upgrade head`, then restart both |
| frontend | build and publish as in [06](06-web-app.md) |
| `deploy/*.conf` | copy to `/etc/httpd/conf.d/`, `apachectl configtest && systemctl reload httpd` |
| `deploy/pico-reader.service` | copy to `/etc/systemd/system/`, `systemctl daemon-reload && systemctl restart pico-reader` |
| `deploy/pico-reader-indexer.service` | copy to `/etc/systemd/system/`, `systemctl daemon-reload && systemctl restart pico-reader-indexer` |

## Logs and status

```bash
systemctl status pico-reader
journalctl -u pico-reader -f                       # API log (sign-ins, emails sent, errors)
systemctl status pico-reader-indexer
journalctl -u pico-reader-indexer -f               # indexing, dictionary conversion, categories
tail -f /var/log/httpd/books-access.log /var/log/httpd/books-error.log
docker logs pico-reader-db
tail /home/tsp/pico-reader-backup.log
```

## Restoring the database

From a local dump (or download one from R2 `backups/` first):

```bash
systemctl stop pico-reader pico-reader-indexer
docker exec pico-reader-db dropdb -U reader reader
docker exec pico-reader-db createdb -U reader reader
gunzip -c /home/tsp/backups/pico-reader/reader-YYYYMMDD.sql.gz | docker exec -i pico-reader-db psql -U reader -d reader
cd /home/tsp/code/pico-reader/backend && sudo -u tsp .venv/bin/alembic upgrade head   # a dump older than the code catches up
systemctl start pico-reader pico-reader-indexer
```

On a new server, set up the database container ([04](04-backend.md) §1), restore the dump, then run
`alembic upgrade head` as above (it does nothing if the dump is current). Books and dictionaries are in R2 and
need no restore.

## Rotating secrets

| Secret | Where to change it |
|---|---|
| R2 token | Cloudflare → R2 → Manage API tokens: create a new one ([01](01-cloudflare.md) §2), put it in `reader.env`, restart both services, delete the old one |
| Email token | Cloudflare → API Tokens; `CLOUDFLARE_EMAIL_API_TOKEN` in `reader.env`, restart |
| Groq key | console.groq.com → API Keys: create a new one, `GROQ_API_KEY` in `reader.env`, restart both services, delete the old one |
| `SECRET_KEY` | new value in `reader.env`, restart; every device has to sign in again |
| Database password | `docker exec pico-reader-db psql -U reader -c "ALTER ROLE reader PASSWORD '<new>'"`, then `DATABASE_URL` in `reader.env`, restart |

After each change, update the copy in `~/tsp-configs/pico-reader/`.
