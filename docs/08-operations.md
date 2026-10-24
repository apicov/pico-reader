# 08 — Operations

## Deploying a change

From the workstation checkout, after committing:

```bash
git archive HEAD | ssh root@172.104.159.186 'cd /home/tsp/code/pico-reader && tar x && chown -R tsp:tsp .'
```

Then on the server, depending on what changed:

| Changed | Run |
|---|---|
| backend code | `systemctl restart pico-reader` |
| `backend/requirements.txt` | as tsp in `backend/`: `.venv/bin/pip install -r requirements.txt`, then `restorecon -R .venv/bin` and restart |
| a migration | as tsp in `backend/`: `.venv/bin/alembic upgrade head`, then restart |
| frontend | build and publish as in [06](06-web-app.md) |
| `deploy/*.conf` | copy to `/etc/httpd/conf.d/`, `apachectl configtest && systemctl reload httpd` |
| `deploy/pico-reader.service` | copy to `/etc/systemd/system/`, `systemctl daemon-reload && systemctl restart pico-reader` |

## Logs and status

```bash
systemctl status pico-reader
journalctl -u pico-reader -f                       # API log (sign-ins, emails sent, errors)
tail -f /var/log/httpd/books-access.log /var/log/httpd/books-error.log
docker logs pico-reader-db
tail /home/tsp/pico-reader-backup.log
```

## Restoring the database

From a local dump (or download one from R2 `backups/` first):

```bash
systemctl stop pico-reader
docker exec pico-reader-db dropdb -U reader reader
docker exec pico-reader-db createdb -U reader reader
gunzip -c /home/tsp/backups/pico-reader/reader-YYYYMMDD.sql.gz | docker exec -i pico-reader-db psql -U reader -d reader
systemctl start pico-reader
```

On a new server, set up the database container ([04](04-backend.md) §1) and restore instead of running
`alembic upgrade head`. Books and dictionaries are in R2 and need no restore.

## Rotating secrets

| Secret | Where to change it |
|---|---|
| R2 token | Cloudflare → R2 → Manage API tokens: create a new one ([01](01-cloudflare.md) §2), put it in `reader.env`, restart, delete the old one |
| Email token | Cloudflare → API Tokens; `CLOUDFLARE_EMAIL_API_TOKEN` in `reader.env`, restart |
| `SECRET_KEY` | new value in `reader.env`, restart; every device has to sign in again |
| Database password | `docker exec pico-reader-db psql -U reader -c "ALTER ROLE reader PASSWORD '<new>'"`, then `DATABASE_URL` in `reader.env`, restart |

After each change, update the copy in `~/tsp-configs/pico-reader/`.
