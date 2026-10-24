# 05 — Apache and HTTPS

Apache (httpd) serves the web app's files and passes `/api` and `/health` to the backend. Let's Encrypt
provides the certificate. The DNS record ([02](02-dns.md)) must resolve before step 3.

## 1. First start of Apache

On a fresh box only: Fedora's `mod_ssl` needs its placeholder certificate before the first start, and the
welcome page goes:

```bash
/usr/libexec/httpd-ssl-gencerts
rm -f /etc/httpd/conf.d/welcome.conf
systemctl enable --now httpd
```

## 2. Port 80

The port-80 host only answers certbot's challenges and redirects everything else to HTTPS:

```bash
mkdir -p /var/www/acme /var/www/pico-reader
cp /home/tsp/code/pico-reader/deploy/books-http.conf /etc/httpd/conf.d/
apachectl configtest && systemctl reload httpd
```

## 3. Certificate

```bash
certbot certonly --webroot -w /var/www/acme -d books.apicov.xyz --agree-tos -m you@example.com
```

Renewal is automatic (Fedora's `certbot-renew.timer`); Apache reloads after each renewal through a deploy hook:

```bash
systemctl enable --now certbot-renew.timer
printf '#!/bin/sh\nsystemctl reload httpd\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-httpd.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-httpd.sh
certbot renew --dry-run
```

## 4. HTTPS host

```bash
cp /home/tsp/code/pico-reader/deploy/books-https.conf /etc/httpd/conf.d/
apachectl configtest && systemctl reload httpd
curl -s https://books.apicov.xyz/health
```

What `deploy/books-https.conf` does:

- `/` → `/var/www/pico-reader` (the built web app). The app uses hash routes (`/#/…`), so no rewrite rules
  are needed.
- `index.html`, `sw.js` and `manifest.webmanifest` are sent with `Cache-Control: no-cache`, so a new build
  reaches devices; the hashed files in `assets/` are cached for a year.
- `/api` and `/health` → `http://127.0.0.1:8030` (the backend), with `X-Forwarded-Proto: https`.
