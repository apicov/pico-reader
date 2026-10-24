# Pico Reader

A personal e-book reader (PDF, EPUB, Markdown) for Android and the web, with an offline library, offline
dictionaries and AI translation. Live at https://books.apicov.xyz.

- `backend/` — FastAPI API (sign-in, library, signed R2 links, uploads, reading positions)
- `frontend/` — React + MUI + Vite app, Capacitor for Android
- `deploy/` — systemd unit, Apache hosts, backup script
- `docs/` — how to set the whole system up from scratch: start at [docs/README.md](docs/README.md)
