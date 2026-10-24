"""reader — add books to the library from this computer.

  reader login you@example.com [--server URL]      (emails a code)
  reader login you@example.com --code 123456
  reader add book.pdf|book.epub [--title T] [--author A] [--lang de] [--id ID] [--cover image]
  reader add-quarto path/to/book [--lang en] [--pdf book.pdf] [--id ID] [--cover image]
  reader list
  reader delete ID
"""

import argparse
import sys
import tempfile
from pathlib import Path

from readertool import client, metadata, quarto
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
    s = sub.add_parser("add-quarto", help="render a Quarto book and add it as a reflowable book")
    s.add_argument("folder", type=Path)
    _common(s)
    s.add_argument("--pdf", type=Path, help="also add this PDF of the book (and use its first page as cover)")
    sub.add_parser("list", help="list the library")
    sub.add_parser("delete", help="delete a book and its files").add_argument("id")
    args = p.parse_args()

    try:
        {"login": login, "add": add, "add-quarto": add_quarto, "list": list_books, "delete": delete}[args.cmd](args)
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
        book_id = _upload(args, title, args.author or meta.get("author", ""), language, files)
    print(f"added {title!r} as {book_id}")


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


if __name__ == "__main__":
    main()
