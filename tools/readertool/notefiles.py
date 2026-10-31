"""How the study computer's files look: what the app sends as a file (or a journal entry), a note as a .md file with
front matter, and file names that are safe and unique."""

import hashlib
import re
from datetime import datetime
from pathlib import Path

SOURCES_MARK = "<!-- sources from the app: changes below this line are not synced -->"


TEXT_SUFFIXES = {".md", ".markdown", ".txt"}


# a snippet's language → file extension and line comment ('' = no header: the format has no comments)
LANGUAGES = {
    "python": ("py", "#"), "py": ("py", "#"), "javascript": ("js", "//"), "js": ("js", "//"),
    "typescript": ("ts", "//"), "ts": ("ts", "//"), "tsx": ("tsx", "//"), "jsx": ("jsx", "//"),
    "rust": ("rs", "//"), "go": ("go", "//"), "c": ("c", "//"), "cpp": ("cpp", "//"), "c++": ("cpp", "//"),
    "java": ("java", "//"), "kotlin": ("kt", "//"), "swift": ("swift", "//"), "csharp": ("cs", "//"),
    "bash": ("sh", "#"), "sh": ("sh", "#"), "shell": ("sh", "#"), "zsh": ("sh", "#"), "fish": ("fish", "#"),
    "ruby": ("rb", "#"), "r": ("r", "#"), "julia": ("jl", "#"), "perl": ("pl", "#"), "yaml": ("yaml", "#"),
    "toml": ("toml", "#"), "sql": ("sql", "--"), "lua": ("lua", "--"), "haskell": ("hs", "--"),
    "elixir": ("ex", "#"), "nix": ("nix", "#"), "makefile": ("mk", "#"), "dockerfile": ("Dockerfile", "#"),
    "html": ("html", ""), "css": ("css", ""), "json": ("json", ""), "markdown": ("md", ""), "latex": ("tex", "%"),
}


def safe_name(name: str, limit: int = 80) -> str:
    """A file name from a title: no slashes or control characters, not hidden, not too long."""
    name = re.sub(r"[/\\\x00-\x1f]+", " ", name).strip().lstrip(".")
    return re.sub(r"\s+", " ", name)[:limit].strip() or "untitled"


def unique_path(folder: Path, stem: str, suffix: str) -> Path:
    path = folder / f"{stem}{suffix}"
    n = 2
    while path.exists():
        path = folder / f"{stem} ({n}){suffix}"
        n += 1
    return path


def front_matter(fields: dict) -> str:
    lines = [f"{k}: {v}" for k, v in fields.items() if v not in (None, "")]
    return "---\n" + "\n".join(lines) + "\n---\n"


def parse_front_matter(text: str) -> tuple[dict, str]:
    """({key: value}, the rest) for a file starting with a `---` block; ({}, text) otherwise."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text
    fields = {}
    for line in text[4:end].splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip()
    return fields, text[end + 5:]


def _where(meta: dict) -> str:
    parts = [meta.get("heading") or ""]
    if meta.get("progress") is not None:
        parts.append(f"{round(meta['progress'] * 100)}%")
    return ", ".join(p for p in parts if p)


def drop_file(drop: dict) -> tuple[str, str, str]:
    """(file name stem, suffix, content) for something sent from the app."""
    meta = drop.get("meta") or {}
    sent = datetime.fromisoformat(drop["created_at"]).astimezone()
    label = meta.get("book_title") or drop.get("title") or drop["kind"]
    kind_word = {"snippet": "code", "highlight": "highlight", "note": "note", "text": "text"}[drop["kind"]]
    stem = safe_name(f"{sent:%Y-%m-%d %H%M} {label} – {kind_word}")
    if drop["kind"] == "snippet":
        ext, comment = LANGUAGES.get(drop.get("language", "").lower(), ("txt", ""))
        header = ""
        if comment:
            source = " · ".join(p for p in (meta.get("book_title"), _where(meta), drop.get("title")) if p)
            header = f"{comment} {source or 'From the reader'}\n{comment} sent {sent:%Y-%m-%d %H:%M}\n\n"
        return stem, f".{ext}", header + drop["body"].rstrip("\n") + "\n"
    head = front_matter({"kind": drop["kind"], "book": meta.get("book_title"), "where": _where(meta),
                         "sent": f"{sent:%Y-%m-%d %H:%M}"})
    title = f"# {drop['title']}\n\n" if drop.get("title") else ""
    body = drop["body"].strip()
    if drop["kind"] == "highlight":
        body = "\n".join(f"> {line}" if line else ">" for line in body.splitlines())
    return stem, ".md", f"{head}\n{title}{body}\n"


JOURNAL = "journal.md"  # the inbox's running file: what's sent "to the running file" is added at its end


def journal_entry(drop: dict) -> str:
    """One item for the running file: a heading line (when, from where, what), then the text; code fenced."""
    meta = drop.get("meta") or {}
    sent = datetime.fromisoformat(drop["created_at"]).astimezone()
    kind = {"snippet": "code", "highlight": "highlight", "note": "note", "text": "text"}[drop["kind"]]
    if drop["kind"] == "snippet" and drop.get("language"):
        kind += f" ({drop['language']})"
    head = " · ".join(p for p in (f"{sent:%Y-%m-%d %H:%M}", meta.get("book_title"), _where(meta), drop.get("title"), kind) if p)
    body = drop["body"].strip("\n")
    if drop["kind"] == "snippet":
        fence = "````" if "```" in body else "```"
        body = f"{fence}{drop.get('language', '')}\n{body}\n{fence}"
    elif drop["kind"] == "highlight":
        body = "\n".join(f"> {line}" if line else ">" for line in body.splitlines())
    return f"\n---\n\n## {head}\n\n{body}\n"


def note_file(note: dict) -> str:
    sources = note.get("sources") or []
    listed = "".join(f"\n[{i}] {s.get('title', '')}{', ' + s['heading'] if s.get('heading') else ''}: "
                     f"“{s.get('text', '')[:300]}”\n" for i, s in enumerate(sources, 1))
    tail = f"\n{SOURCES_MARK}\n{listed}" if sources else ""
    head = front_matter({"id": note["id"], "title": note["title"], "book": note.get("book_title"),
                         "updated": note["updated_at"]})
    return f"{head}\n{note['markdown'].strip()}\n{tail}"


def read_note_file(path: Path) -> tuple[dict, str, str]:
    """(front matter, title, Markdown without the sources) of a file in notes/."""
    fields, rest = parse_front_matter(path.read_text(encoding="utf-8"))
    body = rest.split(SOURCES_MARK, 1)[0].strip()
    return fields, fields.get("title") or path.stem, body


def digest(title: str, markdown: str) -> str:
    return hashlib.sha256(f"{title}\0{markdown.strip()}".encode()).hexdigest()
