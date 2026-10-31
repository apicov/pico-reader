"""reader index: the books' search index, built on this computer (or queued on the server)."""

import tempfile
from pathlib import Path

from pico_core.formats import TEXT_FORMATS
from readertool.client import Api, ToolError

CHUNKS_PER_REQUEST = 100


def register(sub) -> None:
    s = sub.add_parser("index", help="build the search index of books (on this computer)")
    s.add_argument("ids", nargs="*", help="book ids (default with --all: every book)")
    s.add_argument("--all", action="store_true", help="every book whose index is missing or out of date")
    s.add_argument("--force", action="store_true", help="index again even when up to date")
    s.add_argument("--server", action="store_true", help="queue the books on the server instead of indexing here")
    s.set_defaults(run=index_books)


def index_books(args) -> None:
    import requests

    from pico_core import embed, indexing  # the embedding model is heavy: loaded only for this command

    api = Api()
    books = api.get("/api/library")["books"]
    if args.ids:
        books = [b for b in books if b["id"] in args.ids]
    elif not args.all:
        raise ToolError("name book ids, or pass --all")
    for book in books:
        fmt = next((f for f in TEXT_FORMATS if f in book["formats"]), None)
        if not fmt:
            continue
        sha = book["formats"][fmt]["sha256"]
        if book.get("index") and book["index"]["sha256"] == sha and not args.force:
            print(f"{book['title']}: up to date")
            continue
        if args.server:
            job = api.post(f"/api/books/{book['id']}/reindex")["job"]
            print(f"{book['title']}: queued on the server (job {job})")
            continue
        print(f"{book['title']} ({fmt})")
        with tempfile.TemporaryDirectory() as tmp:
            link = api.get(f"/api/books/{book['id']}/download", params={"kind": fmt})
            path = Path(tmp) / f"book.{fmt}"
            with requests.get(link["url"], stream=True, timeout=600) as r:
                r.raise_for_status()
                with path.open("wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            found = indexing.read_passages(path, fmt)
        if not found:
            print("  no text found (a scanned PDF needs a text version first)")
            continue
        print(f"  {len(found)} passages, embedding…")
        api.post(f"/api/admin/books/{book['id']}/index/start",
                 {"format": fmt, "sha256": sha, "model": embed.MODEL, "word_count": indexing.word_count(found)})
        for rows in indexing.index_rows(found, CHUNKS_PER_REQUEST):
            api.post_list(f"/api/admin/books/{book['id']}/index/chunks",
                          [{**row, "embedding": [round(float(x), 6) for x in row["embedding"]]} for row in rows])
        api.post(f"/api/admin/books/{book['id']}/index/finish")  # the offline search file + history
        print("  indexed")
