# Pico Reader documentation

How the system is built and how to set it up from nothing: the accounts, the server, and the code in this
repository. Follow the guides in order for a fresh install.

| Guide | What it covers |
|---|---|
| [00 Overview](00-overview.md) | What runs where, names and addresses, how a book gets to a device |
| [01 Cloudflare](01-cloudflare.md) | R2 bucket, its token and CORS; the email sender |
| [02 DNS](02-dns.md) | The `books.apicov.xyz` record at Namecheap |
| [03 Server](03-server.md) | A new Fedora Linode: packages, firewall, users, SSH, SELinux |
| [04 Backend](04-backend.md) | Database, API service, settings, sign-in allowlist, backups |
| [05 Apache and HTTPS](05-apache-https.md) | Virtual hosts, certificates, renewal |
| [06 Web app](06-web-app.md) | Building and publishing the frontend |
| [07 Local development](07-local-development.md) | Running and testing everything on a workstation |
| [08 Operations](08-operations.md) | Deploying changes, logs, restoring a backup, rotating keys |
| [09 Android](09-android.md) | Building and installing the Android app |
| [10 Uploads and offline search](10-uploads-and-offline-search.md) | Adding books from the app, the indexing queue, searching offline |
| [tools/README](../tools/README.md) | Adding books and dictionaries from your computer; the reflow book format |

Secrets are never in this repository. The server keeps them in `/etc/pico-reader/reader.env`; a local copy of
every secret file lives outside any repo in `~/tsp-configs/pico-reader/`.
