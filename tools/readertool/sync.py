"""`reader sync`: the reader's study computer and the app, through plain files in one folder (default ~/pico).

  inbox/    what the app (or the chat agent) sends: highlights and notes as Markdown, code as source files
  outbox/   a .md or .txt saved here becomes a note in the app, then moves to outbox/sent/
  notes/    the reader's Notes as .md files, edited here or in the app. A new file becomes a note; deleting a
            file doesn't delete the note (it comes back: notes are deleted in the app); a note deleted in the app
            moves to notes/deleted/. Changed on both sides: the app's version wins and this computer's goes to
            notes/conflicts/.

Every round reads the server once and the folder once; a failure in one part is logged and tried again next
round. What was synced last is kept in ~/.local/state/pico-reader/sync.json.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

import requests

from readertool.client import ToolError

STATE = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "pico-reader" / "sync.json"
SOURCES_MARK = "<!-- sources from the app: changes below this line are not synced -->"
STABLE_SECONDS = 2  # a file younger than this may still be being written: next round
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


class Sync:
    def __init__(self, api, folder: Path, state_path: Path = STATE, log=print, clock=time.time):
        self.api, self.folder, self.state_path, self.log, self.clock = api, folder.expanduser(), state_path, log, clock
        for sub in ("inbox", "outbox/sent", "notes/conflicts", "notes/deleted"):
            (self.folder / sub).mkdir(parents=True, exist_ok=True)
        all_state = json.loads(state_path.read_text()) if state_path.exists() else {}
        self._all = all_state
        self.state = all_state.setdefault(str(self.folder), {"notes": {}})

    def save_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._all, indent=1))
        tmp.replace(self.state_path)

    def _stable(self, path: Path) -> bool:
        return self.clock() - path.stat().st_mtime >= STABLE_SECONDS

    def run_once(self) -> dict:
        """One round; returns what happened, e.g. {'inbox': 2, 'outbox': 0, 'notes': 1}."""
        done = {}
        for part in (self.inbox, self.outbox, self.notes):
            try:
                done[part.__name__] = part()
            except (ToolError, requests.RequestException, OSError) as e:
                self.log(f"{part.__name__}: {e} (trying again next round)")
                done[part.__name__] = 0
            finally:
                self.save_state()
        return done

    # --- app → computer ---

    def inbox(self) -> int:
        n = 0
        for drop in self.api.get("/api/drops"):
            stem, suffix, content = drop_file(drop)
            path = unique_path(self.folder / "inbox", stem, suffix)
            path.write_text(content, encoding="utf-8")
            self.api.post(f"/api/drops/{drop['id']}/delivered")
            self.log(f"inbox: {path.name}")
            n += 1
        return n

    # --- computer → app ---

    def outbox(self) -> int:
        n = 0
        for path in sorted((self.folder / "outbox").iterdir()):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES or path.name.startswith(".") \
                    or not self._stable(path):
                continue
            fields, body = parse_front_matter(path.read_text(encoding="utf-8"))
            if not body.strip():
                continue
            self.api.post("/api/notes", {"title": fields.get("title") or path.stem, "markdown": body.strip(),
                                         "origin": "computer"})
            shutil.move(path, unique_path(self.folder / "outbox" / "sent", path.stem, path.suffix))
            self.log(f"outbox: {path.name} → a note in the app")
            n += 1
        return n

    # --- notes, both ways ---

    def _write_note(self, note: dict, path: Path | None) -> Path:
        stem = safe_name(note["title"])
        if path is None or path.stem != stem:  # new, or renamed in the app
            target = self.folder / "notes" / f"{stem}.md"
            if target.exists() and target != path:
                target = unique_path(self.folder / "notes", stem, ".md")
            if path is not None and path.exists():
                path.rename(target)
            path = target
        path.write_text(note_file(note), encoding="utf-8")
        self.state["notes"][note["id"]] = {"updated_at": note["updated_at"], "file": path.name,
                                           "hash": digest(note["title"], note["markdown"])}
        return path

    def notes(self) -> int:
        folder = self.folder / "notes"
        known = self.state["notes"]
        remote = {n["id"]: n for n in self.api.get("/api/notes")}
        files = {}  # note id → its file here; files without an id are new notes
        new_files = []
        for path in sorted(folder.glob("*.md")):
            fields, _, _ = read_note_file(path)
            if fields.get("id"):
                files[fields["id"]] = path
            elif self._stable(path):
                new_files.append(path)
        changes = 0
        deleted = [i for i in known if i not in remote]  # before new files add notes the list above doesn't have
        for note_id, note in remote.items():
            st, path = known.get(note_id), files.get(note_id)
            if path is None:  # new in the app, or the file was deleted here: (again) from the app
                self._write_note(note, None)
                changes += 1
                continue
            _, title, body = read_note_file(path)
            local_changed = st is None or digest(title, body) != st["hash"]
            remote_changed = st is None or note["updated_at"] != st["updated_at"]
            if not local_changed and not remote_changed:
                continue
            if st is not None and local_changed and not remote_changed:
                if not self._stable(path):
                    continue
                try:
                    saved = self.api.patch(f"/api/notes/{note_id}", {"title": title, "markdown": body,
                                                                    "updated_at_was": st["updated_at"]})
                except ToolError as e:
                    if e.status != 409:
                        raise
                    note = self.api.get(f"/api/notes/{note_id}")  # changed in the app meanwhile: a conflict
                    self._conflict(path, title, note)
                    changes += 1
                    continue
                self._write_note(saved, path)
                self.log(f"notes: {path.name} → the app")
            elif st is not None and remote_changed and not local_changed:
                self._write_note(note, path)
                self.log(f"notes: {note['title']} ← the app")
            elif digest(title, body) == digest(note["title"], note["markdown"]):
                self._write_note(note, path)  # the same on both sides (e.g. the state was lost)
            else:
                self._conflict(path, title, note)
            changes += 1
        for path in new_files:
            _, title, body = read_note_file(path)
            if not body:
                continue
            note = self.api.post("/api/notes", {"title": title, "markdown": body, "origin": "computer"})
            self._write_note(note, path)
            self.log(f"notes: {path.name} → a new note in the app")
            changes += 1
        for note_id in deleted:  # deleted in the app
            path = folder / known.pop(note_id)["file"]
            if path.exists():
                path.rename(unique_path(folder / "deleted", path.stem, ".md"))
                self.log(f"notes: {path.name} was deleted in the app → notes/deleted/")
                changes += 1
        return changes

    def _conflict(self, path: Path, title: str, note: dict) -> None:
        stamp = datetime.fromtimestamp(self.clock()).strftime("%Y-%m-%d %H%M")
        copy = unique_path(self.folder / "notes" / "conflicts", safe_name(f"{title} (conflict {stamp})"), ".md")
        shutil.copy2(path, copy)
        self._write_note(note, path)
        self.log(f"notes: {title} changed here and in the app; the app's version kept, yours is in conflicts/{copy.name}")


def run(api, folder: Path, interval: float, once: bool) -> None:
    sync = Sync(api, folder)
    print(f"syncing {sync.folder} every {interval:g} s (Ctrl+C stops)" if not once else f"syncing {sync.folder}")
    while True:
        sync.run_once()
        if once:
            return
        time.sleep(interval)


SERVICE = "pico-reader-sync.service"


def install(folder: Path, interval: float) -> None:
    """A systemd user service: starts with the session, restarts after a failure."""
    reader = Path(__file__).resolve().parent.parent / "reader"
    unit = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user" / SERVICE
    unit.parent.mkdir(parents=True, exist_ok=True)
    unit.write_text(f"""[Unit]
Description=Pico Reader: sync the study computer's folder with the app
After=network-online.target

[Service]
ExecStart={reader} sync --folder {folder.expanduser()} --interval {interval:g}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
""")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", SERVICE], check=True)
    print(f"installed {unit}; logs: journalctl --user -u {SERVICE} -f")


def uninstall() -> None:
    unit = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user" / SERVICE
    subprocess.run(["systemctl", "--user", "disable", "--now", SERVICE], check=False)
    unit.unlink(missing_ok=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    print("removed the sync service")
