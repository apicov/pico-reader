# Server setup

The reader runs on a Fedora box with Apache (httpd), certbot and Docker already installed, as the
`tsp` user. Everything below runs as root unless it says otherwise.

## DNS

An A record `books` → the server's IP at the domain's DNS host (Namecheap for apicov.xyz).

## Database

Postgres with pgvector (the search phase needs it), only on localhost:

    docker run -d --name pico-reader-db --restart unless-stopped \
        -e POSTGRES_USER=reader -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=reader \
        -v pico-reader-pg:/var/lib/postgresql/data -p 127.0.0.1:5440:5432 \
        docker.io/pgvector/pgvector:pg16 -c shared_buffers=32MB -c max_connections=20

## Backend

1. Copy the repo to `/home/tsp/code/pico-reader` (owned by `tsp`).
2. As `tsp`, in `backend/`: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`
3. SELinux: systemd may only start binaries labelled `bin_t`:
   `chcon -R -t bin_t /home/tsp/code/pico-reader/backend/.venv/bin`
4. Settings in `/etc/pico-reader/reader.env` (mode 600), see `backend/.env.example`. In production set
   `ENVIRONMENT=production` and the email keys, or sign-in codes are not sent at all.
5. Schema: `set -a; . /etc/pico-reader/reader.env; set +a; cd backend && .venv/bin/alembic upgrade head`
6. `cp deploy/pico-reader.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now pico-reader`
7. Allow sign-in: `.venv/bin/python -m app.cli add you@example.com "Name" --admin` (with the env loaded).

## Web server and certificate

1. `cp deploy/httpd-books-http.conf /etc/httpd/conf.d/` and `systemctl reload httpd`
2. `certbot certonly --webroot -w /var/www/acme -d books.apicov.xyz`
3. `cp deploy/httpd-books-https.conf /etc/httpd/conf.d/` and `systemctl reload httpd`

## Web app

In `frontend/`: `npm ci && npm run build:web`, then copy `dist/` to `/var/www/pico-reader`
(`restorecon -R /var/www/pico-reader` so httpd may read it).

## R2

Bucket `pico-library`, private, with a token scoped to that bucket only. CORS, so the web app may
download and the desktop tool may upload:

    [{"AllowedOrigins": ["https://books.apicov.xyz", "http://localhost:5173", "https://localhost",
                         "capacitor://localhost"],
      "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600}]
