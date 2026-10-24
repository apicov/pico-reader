"""reader — add books to the library from this computer.

  reader login you@example.com [--server URL]      (emails a code)
  reader login you@example.com --code 123456
  reader add book.pdf|book.epub [--title T] [--author A] [--lang de] [--id ID] [--cover image]
  reader add book.pdf --reflow | --reflow-from marker-output.md     (also a text version)
  reader add-markdown book.md --title T [--author A] --lang de
  reader add-quarto path/to/book [--lang en] [--pdf book.pdf] [--id ID] [--cover image]
  reader list
  reader delete ID
  reader index [BOOK_ID ...] [--all] [--force]           (search index: passages + embeddings)
  reader dict-add path/to/stardict-folder --from de --to es [--name N]
  reader dict-add-all ~/Documents/dic/converted [--map dictionaries.json] [--only duden,ldaf]
  reader dict-list
  reader dict-delete ID
"""

import argparse
import sys
import tempfile
from pathlib import Path

import json

from readertool import client, markdown, metadata, passages, quarto, stardict
from readertool.client import Api, ToolError

_IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def main() -> None:
    p = argparse.ArgumentParser(prog="reader", description="Add books to the reader's library.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("login", help="sign in as an admin (a code is emailed)")
    s.add_argument("email")
    s.add_argument("--server", default=client.DEFAULT_SERVER)
    s.add_argument("--code", help="the code from the email")
    s = sub.add_parser("add", help="add a PDF or EPUB")
    s.add_argument("file", type=Path)
    _common(s)
    s.add_argument("--title")
    s.add_argument("--author")
    s.add_argument("--reflow", action="store_true", help="PDF: also a text version, made with marker")
    s.add_argument("--reflow-from", type=Path, help="PDF: also a text version, from this Markdown (e.g. marker output)")
    s = sub.add_parser("add-markdown", help="add a Markdown file (with its images) as a reflowable book")
    s.add_argument("file", type=Path)
    _common(s)
    s.add_argument("--title", required=True)
    s.add_argument("--author", default="")
    s = sub.add_parser("add-quarto", help="render a Quarto book and add it as a reflowable book")
    s.add_argument("folder", type=Path)
    _common(s)
    s.add_argument("--pdf", type=Path, help="also add this PDF of the book (and use its first page as cover)")
    s = sub.add_parser("dict-add", help="convert and upload a StarDict dictionary")
    s.add_argument("folder", type=Path)
    s.add_argument("--from", dest="from_lang", required=True, help="language of the headwords, e.g. de")
    s.add_argument("--to", dest="to_lang", required=True, help="language of the definitions")
    s.add_argument("--name", help="name shown in the app (default: the dictionary's own)")
    s = sub.add_parser("dict-add-all", help="convert and upload every dictionary listed in the map file")
    s.add_argument("folder", type=Path)
    s.add_argument("--map", type=Path, default=Path(__file__).resolve().parent.parent / "dictionaries.json")
    s.add_argument("--only", help="comma-separated folder names")
    sub.add_parser("dict-list", help="list the dictionaries")
    sub.add_parser("dict-delete", help="delete a dictionary").add_argument("id")
    s = sub.add_parser("index", help="build the search index of books (on this computer)")
    s.add_argument("ids", nargs="*", help="book ids (default with --all: every book)")
    s.add_argument("--all", action="store_true", help="every book whose index is missing or out of date")
    s.add_argument("--force", action="store_true", help="index again even when up to date")
    sub.add_parser("list", help="list the library")
    sub.add_parser("delete", help="delete a book and its files").add_argument("id")
    args = p.parse_args()

    try:
        {"login": login, "add": add, "add-markdown": add_markdown, "add-quarto": add_quarto, "list": list_books, "delete": delete, "index": index_books,
         "dict-add": dict_add, "dict-add-all": dict_add_all, "dict-list": dict_list, "dict-delete": dict_delete}[args.cmd](args)
    except ToolError as e:
        sys.exit(f"error: {e}")


def _common(s: argparse.ArgumentParser) -> None:
    s.add_argument("--lang", help="ISO 639-1 language of the book, e.g. de")
    s.add_argument("--id", help="update this book instead of creating a new one")
    s.add_argument("--cover", type=Path, help="cover image (jpg, png, webp)")


def login(args) -> None:
    server = args.server.rstrip("/")
    if args.code:
        client.login(server, args.email, args.code.strip())
        print("signed in")
    else:
        client.send_code(server, args.email)
        print(f"If {args.email} can sign in, a code is on its way. Then: reader login {args.email} --code <code>")


def _cover(args, files: dict, fallback_pdf: Path | None, tmp: Path) -> None:
    if args.cover:
        files["cover"] = (args.cover, _IMAGE_TYPES[args.cover.suffix.lower()])
    elif fallback_pdf:
        files["cover"] = (metadata.pdf_cover(fallback_pdf, tmp / "cover.jpg"), "image/jpeg")


def add(args) -> None:
    path: Path = args.file
    suffix = path.suffix.lower()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        if suffix == ".pdf":
            meta = metadata.pdf_metadata(path)
            files = {"pdf": (path, "application/pdf")}
            _cover(args, files, path, tmp)
        elif suffix == ".epub":
            meta = metadata.epub_metadata(path, tmp / "cover")
            files = {"epub": (path, "application/epub+zip")}
            if meta["cover"] and not args.cover:
                files["cover"] = meta["cover"]
            else:
                _cover(args, files, None, tmp)
        else:
            raise ToolError("add takes a .pdf or .epub (use add-quarto for a Quarto book)")
        title = args.title or meta.get("title") or path.stem
        language = args.lang or meta.get("language") or ""
        if not language:
            raise ToolError("the file doesn't say its language: pass --lang")
        if suffix == ".pdf" and (args.reflow or args.reflow_from):
            md = args.reflow_from or markdown.marker_to_markdown(path, tmp / "marker")
            info = markdown.build_bundle(md, tmp / "reflow.zip", title, args.author or meta.get("author", ""), language)
            print(f"  text version: {info['chapters']} chapters, {info['images']} images")
            files["reflow"] = (tmp / "reflow.zip", "application/zip")
        book_id = _upload(args, title, args.author or meta.get("author", ""), language, files)
    print(f"added {title!r} as {book_id}")


def add_markdown(args) -> None:
    if not args.lang:
        raise ToolError("pass the book's language with --lang")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        info = markdown.build_bundle(args.file, tmp / "reflow.zip", args.title, args.author, args.lang)
        print(f"  {info['chapters']} chapters, {info['images']} images")
        files = {"reflow": (tmp / "reflow.zip", "application/zip")}
        _cover(args, files, None, tmp)
        book_id = _upload(args, args.title, args.author, args.lang, files)
    print(f"added {args.title!r} as {book_id}")


def add_quarto(args) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bundle = tmp / "reflow.zip"
        info = quarto.build_bundle(args.folder.resolve(), bundle, args.lang or "en")
        print(f"  {info['chapters']} chapters, {info['images']} images, {bundle.stat().st_size / 1e6:.1f} MB")
        files = {"reflow": (bundle, "application/zip")}
        if args.pdf:
            files["pdf"] = (args.pdf, "application/pdf")
        _cover(args, files, args.pdf, tmp)
        book_id = _upload(args, info["title"], info["author"], args.lang or "en", files)
    print(f"added {info['title']!r} as {book_id}")


def _upload(args, title: str, author: str, language: str, files: dict) -> str:
    print(f"{title} — {author or 'unknown author'} [{language}]")
    meta = {"title": title, "author": author, "language": language}
    if args.id:
        meta["id"] = args.id
    return Api().upload("books", meta, files)


def list_books(_args) -> None:
    for b in Api().get("/api/library")["books"]:
        print(f"{b['id']:40} {b['language']:3} {','.join(b['formats']):18} {b['title']}")


def delete(args) -> None:
    Api().delete(f"/api/admin/books/{args.id}")
    print(f"deleted {args.id}")


INDEX_FORMATS = ["reflow", "epub", "pdf"]  # the best text first


def index_books(args) -> None:
    from readertool import embed
    import requests

    api = Api()
    books = api.get("/api/library")["books"]
    if args.ids:
        books = [b for b in books if b["id"] in args.ids]
    elif not args.all:
        raise ToolError("name book ids, or pass --all")
    for book in books:
        fmt = next((f for f in INDEX_FORMATS if f in book["formats"]), None)
        if not fmt:
            continue
        sha = book["formats"][fmt]["sha256"]
        if book.get("index") and book["index"]["sha256"] == sha and not args.force:
            print(f"{book['title']}: up to date")
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
            found = passages.EXTRACTORS[fmt](path)
        if not found:
            print("  no text found (a scanned PDF needs a text version first)")
            continue
        print(f"  {len(found)} passages, embedding…")
        vectors = embed.embed([p.text for p in found])
        words = sum(len(p.text.split()) for p in found)
        api.post(f"/api/admin/books/{book['id']}/index/start",
                 {"format": fmt, "sha256": sha, "model": embed.MODEL, "word_count": words})
        for start in range(0, len(found), 100):
            batch = [{"seq": start + i, "location": p.location, "progress": round(p.progress, 5), "heading": p.heading,
                      "text": p.text, "embedding": [round(float(x), 6) for x in vectors[start + i]]}
                     for i, p in enumerate(found[start:start + 100])]
            api.post_list(f"/api/admin/books/{book['id']}/index/chunks", batch)
        print(f"  indexed")


_DICT_TYPES = {"sqlite": "application/zip", "jsonl": "application/gzip", "res": "application/zip"}


def _upload_dictionary(folder: Path, from_lang: str, to_lang: str, name: str | None) -> None:
    print(f"{folder.name} [{from_lang} → {to_lang}]")
    d = stardict.read(folder)
    dict_id = stardict.dict_id_for(folder)
    print(f"  {len(d.entries)} entries, {len(d.synonyms)} synonyms, {len(d.images)} images")
    with tempfile.TemporaryDirectory() as tmp:
        files = stardict.write_packages(d, dict_id, Path(tmp))
        sizes = ", ".join(f"{k} {p.stat().st_size / 1e6:.1f} MB" for k, p in files.items())
        print(f"  packages: {sizes}")
        Api().upload("dictionaries", {"id": dict_id, "name": name or d.name, "from_lang": from_lang,
                                      "to_lang": to_lang, "entry_count": len(d.entries)},
                     {kind: (path, _DICT_TYPES[kind]) for kind, path in files.items()})
    print(f"  added as {dict_id}")


def dict_add(args) -> None:
    _upload_dictionary(args.folder, args.from_lang, args.to_lang, args.name)


def dict_add_all(args) -> None:
    mapping = {k: v for k, v in json.loads(args.map.read_text()).items() if not k.startswith("_")}
    only = set(args.only.split(",")) if args.only else None
    for folder in sorted(p for p in args.folder.iterdir() if p.is_dir()):
        if only and folder.name not in only:
            continue
        if folder.name not in mapping:
            print(f"skipping {folder.name}: not in {args.map.name}")
            continue
        try:
            _upload_dictionary(folder, *mapping[folder.name], None)
        except Exception as e:  # one broken dictionary mustn't stop the rest
            print(f"  failed: {e}")


def dict_list(_args) -> None:
    for d in Api().get("/api/library")["dictionaries"]:
        print(f"{d['id']:45} {d['from_lang']}→{d['to_lang']} {d['entry_count']:>8}  {d['name']}")


def dict_delete(args) -> None:
    Api().delete(f"/api/admin/dictionaries/{args.id}")
    print(f"deleted {args.id}")


if __name__ == "__main__":
    main()
