#!/bin/sh
# Daily database dump: 14 days on the server, 30 days in R2 (backups/). Runs from tsp's crontab.
set -eu
DIR=/home/tsp/backups/pico-reader
FILE=$DIR/reader-$(date -u +%Y%m%d).sql.gz
mkdir -p "$DIR"
docker exec pico-reader-db pg_dump -U reader -d reader --no-owner | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
find "$DIR" -name 'reader-*.sql.gz' -mtime +14 -delete
cd /home/tsp/code/pico-reader/backend && .venv/bin/python -m app.offsite_backup "$FILE"
