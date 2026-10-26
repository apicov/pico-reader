"""`reader sync`: the reader's study computer and the app, through plain files in one folder (default ~/pico),
and in each project folder (`reader project add`: its own notes/ and inbox/).

  inbox/    what the app (or the chat agent) sends: highlights and notes as Markdown, code as source files
  outbox/   a .md or .txt saved here becomes a note in the app, then moves to outbox/sent/
  notes/    the reader's Notes as .md files, edited here or in the app. A new file becomes a note; deleting a
            file doesn't delete the note (it comes back: notes are deleted in the app); a note deleted in the app
            moves to notes/deleted/. Changed on both sides: the app's version wins and this computer's goes to
            notes/conflicts/.

A note belongs to a project in the app or to none: its file is in that project's notes/ (when the project is on
this computer) or in ~/pico/notes. Moving the file between those folders moves the note; moving the note in the
app moves the file.

A round asks the server one small question (/api/computer/poll) and fetches the notes only when they changed; a
file saved here starts a round within a few seconds. A failure in one part is logged and tried again next round.
What was synced last is kept in ~/.local/state/pico-reader/sync.json.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path

import requests

from readertool.client import CONFIG, ToolError

STATE = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "pico-reader" / "sync.json"
PROJECTS = CONFIG.parent / "projects.json"  # project id → {name, path}: the folders `reader project add` linked
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


def load_projects(path: Path = PROJECTS) -> dict[str, dict]:
    return json.loads(path.read_text()) if path.exists() else {}


def save_projects(projects: dict[str, dict], path: Path = PROJECTS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(projects, indent=2))


def digest(title: str, markdown: str) -> str:
    return hashlib.sha256(f"{title}\0{markdown.strip()}".encode()).hexdigest()


class Sync:
    def __init__(self, api, folder: Path, state_path: Path = STATE, log=print, clock=time.time,
                 projects_path: Path = PROJECTS):
        self.api, self.folder, self.state_path, self.log, self.clock = api, folder.expanduser(), state_path, log, clock
        self.projects_path = projects_path
        for sub in ("inbox", "outbox/sent", "notes/conflicts", "notes/deleted"):
            (self.folder / sub).mkdir(parents=True, exist_ok=True)
        all_state = json.loads(state_path.read_text()) if state_path.exists() else {}
        self._all = all_state
        self.state = all_state.setdefault(str(self.folder), {"notes": {}})
        self._stamp: str | None = None  # the server's notes stamp at the last notes round
        self._seen: tuple = ()  # the notes folders as they were after it
        self._unsettled = False  # a file was still being written: look again soon

    def save_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._all, indent=1))
        tmp.replace(self.state_path)

    def _stable(self, path: Path) -> bool:
        return self.clock() - path.stat().st_mtime >= STABLE_SECONDS

    def spaces(self) -> dict[str | None, Path]:
        """Where notes live here: {None: ~/pico/notes, project id: <project>/notes} (projects read anew each time,
        so one added while the sync runs is picked up)."""
        out: dict[str | None, Path] = {None: self.folder / "notes"}
        for pid, p in load_projects(self.projects_path).items():
            if Path(p["path"]).is_dir():
                out[pid] = Path(p["path"]) / "notes"
        for folder in out.values():
            for sub in ("conflicts", "deleted"):
                (folder / sub).mkdir(parents=True, exist_ok=True)
        return out

    def signature(self) -> tuple:
        """What the notes folders and the outbox look like: a change starts a round at once."""
        files = [f for d in [*self.spaces().values(), self.folder / "outbox"] for f in d.glob("*") if f.is_file()]
        return tuple(sorted((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in files))

    def run_once(self) -> dict:
        """One round; returns what happened, e.g. {'inbox': 2, 'outbox': 0, 'notes': 1}."""
        done = {"inbox": 0, "outbox": 0, "notes": 0}
        try:
            poll = self.api.get("/api/computer/poll")
        except (ToolError, requests.RequestException) as e:
            self.log(f"server: {e} (trying again next round)")
            return done
        for name, part in (("inbox", lambda: self.inbox(poll["drops"])), ("outbox", self.outbox),
                           ("notes", lambda: self.notes(poll["notes_stamp"]))):
            try:
                done[name] = part()
            except (ToolError, requests.RequestException, OSError) as e:
                self.log(f"{name}: {e} (trying again next round)")
            finally:
                self.save_state()
        return done

    # --- app → computer ---

    def inbox(self, drops: list[dict]) -> int:
        n = 0
        projects = load_projects(self.projects_path)
        for drop in drops:
            project = projects.get(drop.get("project_id") or "")
            folder = Path(project["path"]) / "inbox" if project and Path(project["path"]).is_dir() else self.folder / "inbox"
            folder.mkdir(parents=True, exist_ok=True)
            stem, suffix, content = drop_file(drop)
            path = unique_path(folder, stem, suffix)
            path.write_text(content, encoding="utf-8")
            self.api.post(f"/api/drops/{drop['id']}/delivered")
            self.log(f"inbox: {path}")
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

    def _file(self, st: dict) -> Path:
        """A note's file as the state remembers it (older states kept just the name, in ~/pico/notes)."""
        return Path(st["file"]) if os.path.isabs(st["file"]) else self.folder / "notes" / st["file"]

    def _write_note(self, note: dict, path: Path | None, folder: Path, space: str | None) -> Path:
        stem = safe_name(note["title"])
        if path is None or path.stem != stem or path.parent != folder:  # new, renamed, or in another project
            target = folder / f"{stem}.md"
            if target.exists() and target != path:
                target = unique_path(folder, stem, ".md")
            if path is not None and path.exists():
                path.rename(target)
            path = target
        path.write_text(note_file(note), encoding="utf-8")
        self.state["notes"][note["id"]] = {"updated_at": note["updated_at"], "file": str(path), "space": space,
                                           "hash": digest(note["title"], note["markdown"])}
        return path

    def notes(self, stamp: str | None = None) -> int:
        """Only when something changed: the server's stamp, a file here, a file that was still being written."""
        spaces = self.spaces()
        seen = self.signature()
        if stamp is not None and stamp == self._stamp and seen == self._seen and not self._unsettled:
            return 0
        self._unsettled = False
        changes = self._notes(spaces)
        self._stamp, self._seen = stamp, self.signature()
        return changes

    def _notes(self, spaces: dict[str | None, Path]) -> int:
        known = self.state["notes"]
        remote = {n["id"]: n for n in self.api.get("/api/notes")}
        files: dict[str, tuple[str | None, Path]] = {}  # note id → (its space, its file here)
        new_files: list[tuple[str | None, Path]] = []  # files without an id: new notes
        for space, folder in spaces.items():
            for path in sorted(folder.glob("*.md")):
                fields, _, _ = read_note_file(path)
                if fields.get("id"):
                    files.setdefault(fields["id"], (space, path))
                elif self._stable(path):
                    new_files.append((space, path))
                else:
                    self._unsettled = True
        changes = 0
        deleted = [i for i in known if i not in remote]  # before new files add notes the list above doesn't have
        for note_id, note in remote.items():
            st = known.get(note_id)
            target = note.get("project_id") if note.get("project_id") in spaces else None
            space, path = files.get(note_id, (target, None))
            if path is not None and space != target:
                if st is not None and st.get("space") == target and note["updated_at"] == st["updated_at"]:
                    # moved here, from one folder to another: the note moves to that project in the app
                    note = self.api.patch(f"/api/notes/{note_id}", {"project_id": space})
                    self._write_note(note, path, spaces[space], space)
                    self.log(f"notes: {path.name} → project {note.get('project') or '(none)'} in the app")
                    changes += 1
                    continue
                # moved in the app (or its project isn't on this computer): the file follows
                path = path.rename(unique_path(spaces[target], path.stem, ".md"))
                space = target
            if path is None:  # new in the app, or the file was deleted here: (again) from the app
                self._write_note(note, None, spaces[target], target)
                changes += 1
                continue
            _, title, body = read_note_file(path)
            local_changed = st is None or digest(title, body) != st["hash"]
            remote_changed = st is None or note["updated_at"] != st["updated_at"]
            if not local_changed and not remote_changed:
                if st.get("file") != str(path):
                    self._write_note(note, path, spaces[space], space)
                continue
            if st is not None and local_changed and not remote_changed:
                if not self._stable(path):
                    self._unsettled = True
                    continue
                try:
                    saved = self.api.patch(f"/api/notes/{note_id}", {"title": title, "markdown": body,
                                                                    "updated_at_was": st["updated_at"]})
                except ToolError as e:
                    if e.status != 409:
                        raise
                    note = self.api.get(f"/api/notes/{note_id}")  # changed in the app meanwhile: a conflict
                    self._conflict(path, title, note, spaces[space], space)
                    changes += 1
                    continue
                self._write_note(saved, path, spaces[space], space)
                self.log(f"notes: {path.name} → the app")
            elif st is not None and remote_changed and not local_changed:
                self._write_note(note, path, spaces[space], space)
                self.log(f"notes: {note['title']} ← the app")
            elif digest(title, body) == digest(note["title"], note["markdown"]):
                self._write_note(note, path, spaces[space], space)  # the same on both sides (e.g. the state was lost)
            else:
                self._conflict(path, title, note, spaces[space], space)
            changes += 1
        for space, path in new_files:
            _, title, body = read_note_file(path)
            if not body:
                continue
            note = self.api.post("/api/notes", {"title": title, "markdown": body, "origin": "computer",
                                                "project_id": space})
            self._write_note(note, path, spaces[space], space)
            self.log(f"notes: {path.name} → a new note in the app")
            changes += 1
        for note_id in deleted:  # deleted in the app
            path = self._file(known.pop(note_id))
            if path.exists():
                path.rename(unique_path(path.parent / "deleted", path.stem, ".md"))
                self.log(f"notes: {path.name} was deleted in the app → {path.parent.name}/deleted/")
                changes += 1
        return changes

    def _conflict(self, path: Path, title: str, note: dict, folder: Path, space: str | None) -> None:
        stamp = datetime.fromtimestamp(self.clock()).strftime("%Y-%m-%d %H%M")
        copy = unique_path(folder / "conflicts", safe_name(f"{title} (conflict {stamp})"), ".md")
        shutil.copy2(path, copy)
        self._write_note(note, path, folder, space)
        self.log(f"notes: {title} changed here and in the app; the app's version kept, yours is in conflicts/{copy.name}")


def run(api, folder: Path, interval: float, once: bool) -> None:
    """Rounds every `interval` seconds, and within a few seconds of a file saved here."""
    sync = Sync(api, folder)
    if once:
        print(f"syncing {sync.folder}")
        sync.run_once()
        return
    print(f"syncing {sync.folder} every {interval:g} s, and when a file changes (Ctrl+C stops)")
    seen, next_round = None, 0.0
    while True:
        now = time.time()
        try:
            current = sync.signature()
        except OSError:
            current = None
        if current != seen:  # saved here: a round once the file has settled
            seen, next_round = current, min(next_round, now + STABLE_SECONDS + 0.2)
        if now >= next_round:
            sync.run_once()
            seen, next_round = sync.signature(), time.time() + (STABLE_SECONDS + 0.2 if sync._unsettled else interval)
        time.sleep(1)


# --- projects: folders here with their own notes/ and inbox/ ---

def project_add(api, path: Path, name: str | None = None, projects_path: Path = PROJECTS) -> dict:
    """Links `path` to a project in the app (the one of that name, or a new one); the running sync picks it up."""
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise ToolError(f"{path} isn't a folder")
    projects = load_projects(projects_path)
    linked = next((pid for pid, p in projects.items() if Path(p["path"]) == path), None)
    name = " ".join((name or path.name).split())[:60]
    existing = {p["name"].lower(): p for p in api.get("/api/projects")}
    if linked and name.lower() in existing and existing[name.lower()]["id"] != linked:
        raise ToolError(f"You have another project called {name!r} already")
    if not linked and name.lower() in existing:  # the app's project of that name (made on another computer)
        saved = existing[name.lower()]
    else:  # a new project, or this folder's under a new name
        saved = api.put(f"/api/projects/{linked or f'proj-{uuid.uuid4()}'}", {"name": name})
    pid = saved["id"]
    projects[pid] = {"name": saved["name"], "path": str(path)}
    save_projects(projects, projects_path)
    for sub in ("notes", "inbox"):
        (path / sub).mkdir(exist_ok=True)
    return {"id": pid, "name": saved["name"], "path": str(path), "notes": saved["notes"]}


def project_remove(api, path: Path, delete: bool = False, projects_path: Path = PROJECTS) -> dict:
    """Stops syncing `path` (its files stay); `delete` also removes the project in the app (its notes stay there)."""
    path = path.expanduser().resolve()
    projects = load_projects(projects_path)
    pid = next((pid for pid, p in projects.items() if Path(p["path"]) == path), None)
    if pid is None:
        raise ToolError(f"{path} isn't a project (reader project list shows them)")
    gone = projects.pop(pid)
    if delete:
        api.delete(f"/api/projects/{pid}")
    save_projects(projects, projects_path)
    return gone


def project_list(api, projects_path: Path = PROJECTS) -> list[dict]:
    """The app's projects, with their folder on this computer (or None)."""
    here = load_projects(projects_path)
    return [{**p, "path": here.get(p["id"], {}).get("path")} for p in api.get("/api/projects")]


SERVICE = "pico-reader-sync.service"


def _unit() -> Path:
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "systemd" / "user" / SERVICE


def service_installed() -> bool:
    return _unit().exists()


def install(folder: Path, interval: float) -> None:
    """A systemd user service: starts with the session, restarts after a failure."""
    reader = Path(__file__).resolve().parent.parent / "reader"
    unit = _unit()
    unit.parent.mkdir(parents=True, exist_ok=True)
    unit.write_text(f"""[Unit]
Description=Pico Reader: sync the study computer's folder with the app
After=network-online.target

[Service]
ExecStart={reader} sync --folder {folder.expanduser()} --interval {interval:g}
Environment=PYTHONUNBUFFERED=1
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
""")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", SERVICE], check=True)
    print(f"installed {unit}; logs: journalctl --user -u {SERVICE} -f")


def uninstall() -> None:
    unit = _unit()
    subprocess.run(["systemctl", "--user", "disable", "--now", SERVICE], check=False)
    unit.unlink(missing_ok=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
    print("removed the sync service")
