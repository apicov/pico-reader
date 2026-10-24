# deploy/

Server files, installed as described in [docs/](../docs/README.md):

| File | Installed as | Guide |
|---|---|---|
| `pico-reader.service` | `/etc/systemd/system/pico-reader.service` | [04 Backend](../docs/04-backend.md) |
| `backup-db.sh` | run from tsp's crontab | [04 Backend](../docs/04-backend.md) §8 |
| `books-http.conf`, `books-https.conf` | `/etc/httpd/conf.d/` | [05 Apache and HTTPS](../docs/05-apache-https.md) |
