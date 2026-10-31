"""`reader sync`: the reader's study computer and the app, through plain files in one folder (default ~/pico),
and in each project folder (`reader project add`: its own notes/ and inbox/).

  inbox/    what the app (or the chat agent) sends: highlights and notes as Markdown, code as source files; or,
            sent "to the running file", added to the end of inbox/journal.md
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

import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path

import requests

from readertool.client import ToolError
from readertool.notefiles import (
    JOURNAL,
    TEXT_SUFFIXES,
    digest,
    drop_file,
    journal_entry,
    note_file,
    parse_front_matter,
    read_note_file,
    safe_name,
    unique_path,
)
from readertool.projects import PROJECTS, load_projects

STATE = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "pico-reader" / "sync.json"
STABLE_SECONDS = 2  # a file younger than this may still be being written: next round


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

    @property
    def settling(self) -> bool:
        """A file was still being written at the last round: look again soon."""
        return self._unsettled

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
            if drop.get("append"):
                path = folder / JOURNAL
                if not path.exists():
                    path.write_text("# Journal\n\nWhat you send to the running file, the newest at the end.\n", encoding="utf-8")
                with path.open("a", encoding="utf-8") as f:
                    f.write(journal_entry(drop))
            else:
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
        """One pass over the notes: each in the app against its file here, then files that are new here, then
        notes deleted in the app. Returns how many changed."""
        known = self.state["notes"]
        remote = {n["id"]: n for n in self.api.get("/api/notes")}
        files, new_files = self._note_files(spaces)
        deleted = [i for i in known if i not in remote]  # before new files add notes the list above doesn't have
        changes = sum(self._sync_note(note, known.get(note_id), files.get(note_id), spaces)
                      for note_id, note in remote.items())
        changes += sum(self._new_note(path, space, spaces[space]) for space, path in new_files)
        changes += sum(self._deleted_note(known.pop(note_id)) for note_id in deleted)
        return changes

    def _note_files(self, spaces: dict[str | None, Path]) -> tuple[dict[str, tuple[str | None, Path]],
                                                                    list[tuple[str | None, Path]]]:
        """The note files here: {note id: (its space, its file)}, and the files without an id (new notes)."""
        files: dict[str, tuple[str | None, Path]] = {}
        new_files: list[tuple[str | None, Path]] = []
        for space, folder in spaces.items():
            for path in sorted(folder.glob("*.md")):
                fields, _, _ = read_note_file(path)
                if fields.get("id"):
                    files.setdefault(fields["id"], (space, path))
                elif self._stable(path):
                    new_files.append((space, path))
                else:
                    self._unsettled = True
        return files, new_files

    def _sync_note(self, note: dict, st: dict | None, here: tuple[str | None, Path] | None,
                   spaces: dict[str | None, Path]) -> int:
        """A note in the app and its file here (`here`, None when there's none), as last synced (`st`)."""
        target = note.get("project_id") if note.get("project_id") in spaces else None
        space, path = here or (target, None)
        if path is not None and space != target:
            if st is not None and st.get("space") == target and note["updated_at"] == st["updated_at"]:
                return self._moved_here(note, path, space, spaces[space])
            # moved in the app (or its project isn't on this computer): the file follows
            path, space = path.rename(unique_path(spaces[target], path.stem, ".md")), target
        if path is None:  # new in the app, or the file was deleted here: (again) from the app
            self._write_note(note, None, spaces[target], target)
            return 1
        folder = spaces[space]
        _, title, body = read_note_file(path)
        local_changed = st is None or digest(title, body) != st["hash"]
        remote_changed = st is None or note["updated_at"] != st["updated_at"]
        if not local_changed and not remote_changed:
            if st.get("file") != str(path):  # only moved: remember where
                self._write_note(note, path, folder, space)
            return 0
        if st is not None and not remote_changed:
            return self._changed_here(note, st, path, title, body, folder, space)
        if st is not None and not local_changed:
            self._write_note(note, path, folder, space)
            self.log(f"notes: {note['title']} ← the app")
        elif digest(title, body) == digest(note["title"], note["markdown"]):
            self._write_note(note, path, folder, space)  # the same on both sides (e.g. the state was lost)
        else:
            self._conflict(path, title, note, folder, space)
        return 1

    def _moved_here(self, note: dict, path: Path, space: str | None, folder: Path) -> int:
        """The file moved from one folder to another here: the note moves to that project in the app."""
        note = self.api.patch(f"/api/notes/{note['id']}", {"project_id": space})
        self._write_note(note, path, folder, space)
        self.log(f"notes: {path.name} → project {note.get('project') or '(none)'} in the app")
        return 1

    def _changed_here(self, note: dict, st: dict, path: Path, title: str, body: str, folder: Path,
                      space: str | None) -> int:
        """Edited here only: the app gets the new text, unless it changed there meanwhile (a conflict)."""
        if not self._stable(path):
            self._unsettled = True
            return 0
        try:
            saved = self.api.patch(f"/api/notes/{note['id']}", {"title": title, "markdown": body,
                                                                "updated_at_was": st["updated_at"]})
        except ToolError as e:
            if e.status != 409:
                raise
            self._conflict(path, title, self.api.get(f"/api/notes/{note['id']}"), folder, space)
            return 1
        self._write_note(saved, path, folder, space)
        self.log(f"notes: {path.name} → the app")
        return 1

    def _new_note(self, path: Path, space: str | None, folder: Path) -> int:
        """A file without an id: a new note in the app (an empty one waits)."""
        _, title, body = read_note_file(path)
        if not body:
            return 0
        note = self.api.post("/api/notes", {"title": title, "markdown": body, "origin": "computer", "project_id": space})
        self._write_note(note, path, folder, space)
        self.log(f"notes: {path.name} → a new note in the app")
        return 1

    def _deleted_note(self, st: dict) -> int:
        """Deleted in the app: its file goes to deleted/."""
        path = self._file(st)
        if not path.exists():
            return 0
        path.rename(unique_path(path.parent / "deleted", path.stem, ".md"))
        self.log(f"notes: {path.name} was deleted in the app → {path.parent.name}/deleted/")
        return 1

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
            seen, next_round = sync.signature(), time.time() + (STABLE_SECONDS + 0.2 if sync.settling else interval)
        time.sleep(1)
