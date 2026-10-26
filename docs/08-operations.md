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

## Moving R2 to another account

The database refers to files by key and links are signed per request, so moving the bucket means copying the
objects and changing four settings. There's no rebuild, and books already on devices stay.

1. **The new account:** create the bucket (`pico-library`), its CORS policy and an Object Read & Write token,
   as in [01](01-cloudflare.md) §1–3. Then write `/etc/pico-reader/r2-new.env` (root:tsp, 640) with
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Copy the current `R2_*` lines of
   `reader.env` into `r2-old.env` the same way.
2. **Check the new bucket:** the token check of [01](01-cloudflare.md) §2, and the CORS preflight of §3 against
   the new account's host (`204`).
3. **Copy:** as tsp in `backend/`:
   `.venv/bin/python -m app.r2_copy /etc/pico-reader/r2-old.env /etc/pico-reader/r2-new.env`.
   - It copies every object with its key, content type and cache header, skips what's already there, and
     finishes with "N copied, N already there, 0 missing" (exit 1 if anything is missing).
   - The app keeps running meanwhile.
4. **Switch:**
   - `cp reader.env reader.env.before-move`;
   - put the new `R2_*` values into `reader.env`;
   - restart both services.
5. **Copy once more** (the same command): it copies what was uploaded between steps 3 and 4.
6. **Check:**
   - a book not yet on the device opens, and a cover shows;
   - an upload works;
   - the next backup lands in the new bucket (`deploy/backup-db.sh` by hand).
7. **A week later:** delete the old bucket and its token in the old account, then `r2-old.env` and
   `reader.env.before-move`.

**Back out:** restore `reader.env.before-move` and restart (the old bucket is untouched until step 7).

## Rotating secrets

| Secret | Where to change it |
|---|---|
| R2 token | Cloudflare → R2 → Manage API tokens: create a new one ([01](01-cloudflare.md) §2), put it in `reader.env`, restart both services, delete the old one |
| Email token | Cloudflare → API Tokens; `CLOUDFLARE_EMAIL_API_TOKEN` in `reader.env`, restart |
| Groq key | console.groq.com → API Keys: create a new one, `GROQ_API_KEY` in `reader.env`, restart both services, delete the old one |
| `SECRET_KEY` | new value in `reader.env`, restart; every device has to sign in again |
| Database password | `docker exec pico-reader-db psql -U reader -c "ALTER ROLE reader PASSWORD '<new>'"`, then `DATABASE_URL` in `reader.env`, restart |

After each change, update the copy in `~/tsp-configs/pico-reader/`.
