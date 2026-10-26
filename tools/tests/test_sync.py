"""`reader sync` against an in-memory stand-in for the server, in a temporary folder."""

import copy
import os
import subprocess
import time
from pathlib import Path

import pytest
import requests

from readertool.client import ToolError
from readertool import sync as sync_module
from readertool.sync import SOURCES_MARK, Sync, drop_file

T0 = 1_800_000_000.0


class FakeApi:
    """The routes the sync uses, with the server's rules (a stale PATCH is a 409)."""

    def __init__(self):
        self.drops, self.notes, self.delivered, self.down = [], {}, [], False
        self.clock, self.patch_fails, self.projects, self.calls = 0, None, {}, []

    def _tick(self) -> str:
        self.clock += 1
        return f"2026-10-25T10:00:{self.clock:02d}+00:00"

    def add_note(self, title, markdown, sources=(), project_id=None):
        note_id = f"note-{len(self.notes) + 1}"
        self.notes[note_id] = {"id": note_id, "title": title, "markdown": markdown, "book_title": "Die Wolke",
                               "sources": list(sources), "updated_at": self._tick(), "origin": "app",
                               "project_id": project_id, "project": self.projects.get(project_id)}
        return self.notes[note_id]

    def move(self, note_id, project_id):
        self.notes[note_id].update(project_id=project_id, project=self.projects.get(project_id), updated_at=self._tick())

    def get(self, path):
        self.calls.append(path)
        return copy.deepcopy(self._get(path))  # like a server: later changes don't reach what was read

    def _get(self, path):
        if self.down:
            raise requests.ConnectionError("network is down")
        if path == "/api/computer/poll":
            stamp = f"{len(self.notes)}:{max((n['updated_at'] for n in self.notes.values()), default='')}"
            return {"drops": self._get("/api/drops"), "projects": self._get("/api/projects"), "notes_stamp": stamp}
        if path == "/api/drops":
            return [d for d in self.drops if d["id"] not in self.delivered]
        if path == "/api/projects":
            return [{"id": i, "name": n, "notes": sum(x["project_id"] == i for x in self.notes.values())}
                    for i, n in self.projects.items()]
        if path == "/api/notes":
            return list(self.notes.values())
        return self.notes[path.rsplit("/", 1)[1]]

    def post(self, path, body=None):
        if self.down:
            raise requests.ConnectionError("network is down")
        if path.endswith("/delivered"):
            self.delivered.append(path.split("/")[3])
            return None
        note = self.add_note(body["title"], body["markdown"], project_id=body.get("project_id"))
        note["origin"] = body.get("origin", "app")
        return note

    def put(self, path, body):
        pid = path.rsplit("/", 1)[1]
        self.projects[pid] = body["name"]
        return next(p for p in self._get("/api/projects") if p["id"] == pid)

    def delete(self, path):
        pid = path.rsplit("/", 1)[1]
        del self.projects[pid]
        for n in self.notes.values():
            if n["project_id"] == pid:
                n.update(project_id=None, project=None, updated_at=self._tick())

    def patch(self, path, body):
        note = self.notes[path.rsplit("/", 1)[1]]
        if self.patch_fails:
            raise self.patch_fails
        if body.get("updated_at_was") and body["updated_at_was"] != note["updated_at"]:
            raise ToolError("HTTP 409: The note changed meanwhile", 409)
        if "project_id" in body:
            note.update(project_id=body["project_id"], project=self.projects.get(body["project_id"]))
        note.update({k: body[k] for k in ("title", "markdown") if k in body}, updated_at=self._tick())
        return copy.deepcopy(note)


@pytest.fixture
def env(tmp_path):
    api = FakeApi()
    now = [T0]
    log: list[str] = []
    sync = Sync(api, tmp_path / "pico", tmp_path / "state.json", log=log.append, clock=lambda: now[0],
                projects_path=tmp_path / "projects.json")
    return api, sync, tmp_path / "pico", now, log


def age(path: Path, seconds_before: float) -> None:
    os.utime(path, (T0 - seconds_before, T0 - seconds_before))


def drop(i, kind, body, **kw):
    return {"id": f"drop-{i}", "kind": kind, "title": kw.get("title", ""), "language": kw.get("language", ""),
            "body": body, "meta": kw.get("meta", {}), "created_at": "2026-10-25T12:12:00+00:00"}


# --- inbox ---

def test_inbox_highlights_as_markdown_and_code_as_source_files(env):
    api, sync, folder, _, _ = env
    api.drops = [drop(1, "highlight", "Der Alarm kam.\nAm Vormittag.",
                      meta={"book_title": "Die Wolke", "heading": "Kapitel 1", "progress": 0.12}),
                 drop(2, "snippet", "squares = [x * x for x in range(10)]", language="python",
                      meta={"book_title": "Fluent Python", "heading": "2 Lists"}),
                 drop(3, "snippet", '{"a": 1}', language="json", title="Config")]
    assert sync.run_once()["inbox"] == 3
    files = {p.suffix: p for p in (folder / "inbox").iterdir()}
    md = files[".md"].read_text()
    assert files[".md"].name.endswith("Die Wolke – highlight.md")
    assert "book: Die Wolke" in md and "where: Kapitel 1, 12%" in md and "> Der Alarm kam.\n> Am Vormittag." in md
    py = files[".py"].read_text()
    assert files[".py"].name.endswith("Fluent Python – code.py")
    assert py.startswith("# Fluent Python · 2 Lists\n") and py.endswith("squares = [x * x for x in range(10)]\n")
    assert files[".json"].read_text() == '{"a": 1}\n'  # JSON can't have a comment header
    assert api.delivered == ["drop-1", "drop-2", "drop-3"]
    assert sync.run_once()["inbox"] == 0  # delivered: not written twice


def test_inbox_never_overwrites_a_file(env):
    api, sync, folder, _, _ = env
    api.drops = [drop(1, "text", "one"), drop(2, "text", "two")]  # same minute, same name
    sync.run_once()
    assert sorted(p.read_text().strip().splitlines()[-1] for p in (folder / "inbox").iterdir()) == ["one", "two"]


def test_unsafe_titles_make_safe_file_names():
    stem, suffix, _ = drop_file(drop(1, "text", "x", title="../../etc/passwd"))
    assert "/" not in stem and not stem.startswith(".")


# --- outbox ---

def test_outbox_file_becomes_a_note_and_moves_to_sent(env):
    api, sync, folder, _, log = env
    question = folder / "outbox" / "Fragen zu Kapitel 3.md"
    question.write_text("---\ntitle: Kapitel 3\n---\nWarum flieht sie?\n")
    age(question, 10)
    half_written = folder / "outbox" / "draft.md"
    half_written.write_text("still typing")
    age(half_written, 0.5)
    (folder / "outbox" / "image.png").write_bytes(b"\x89PNG")
    assert sync.run_once()["outbox"] == 1
    [note] = api.notes.values()
    assert (note["title"], note["markdown"], note["origin"]) == ("Kapitel 3", "Warum flieht sie?", "computer")
    assert not question.exists() and (folder / "outbox" / "sent" / "Fragen zu Kapitel 3.md").exists()
    assert half_written.exists()  # next round, once it's stable


# --- notes ---

def test_notes_arrive_as_files_with_their_sources(env):
    api, sync, folder, _, _ = env
    api.add_note("Die Wolke: Figuren", "## Figuren\n\nJanna-Berta [1].",
                 sources=[{"title": "Die Wolke", "heading": "Kapitel 1", "text": "Der Alarm kam."}])
    sync.run_once()
    text = (folder / "notes" / "Die Wolke: Figuren.md").read_text()
    assert text.startswith("---\nid: note-1\ntitle: Die Wolke: Figuren\nbook: Die Wolke\n")
    assert "Janna-Berta [1]." in text and SOURCES_MARK in text and "[1] Die Wolke, Kapitel 1: “Der Alarm kam.”" in text


def test_an_edit_here_goes_to_the_app_without_the_sources(env):
    api, sync, folder, _, _ = env
    api.add_note("Figuren", "Alt", sources=[{"title": "B", "heading": "", "text": "q"}])
    sync.run_once()
    path = folder / "notes" / "Figuren.md"
    path.write_text(path.read_text().replace("\nAlt\n", "\nNeu, in vim geschrieben\n").replace("[1] B", "[1] changed"))
    age(path, 5)
    sync.run_once()
    assert api.notes["note-1"]["markdown"] == "Neu, in vim geschrieben"
    assert sync.run_once()["notes"] == 0  # settled


def test_an_edit_in_the_app_and_a_rename_reach_the_file(env):
    api, sync, folder, _, _ = env
    api.add_note("Figuren", "Alt")
    sync.run_once()
    api.notes["note-1"].update(title="Figuren und Orte", markdown="Neu aus der App", updated_at=api._tick())
    sync.run_once()
    assert not (folder / "notes" / "Figuren.md").exists()
    assert "Neu aus der App" in (folder / "notes" / "Figuren und Orte.md").read_text()


def test_a_new_file_becomes_a_note_and_gets_its_id(env):
    api, sync, folder, _, _ = env
    path = folder / "notes" / "Ideen.md"
    path.write_text("# Ideen\n\n- eins\n")
    age(path, 5)
    sync.run_once()
    [note] = api.notes.values()
    assert (note["title"], note["origin"]) == ("Ideen", "computer")
    assert path.read_text().startswith(f"---\nid: {note['id']}\n")
    assert sync.run_once()["notes"] == 0


def test_a_deleted_file_comes_back_and_a_note_deleted_in_the_app_moves_aside(env):
    api, sync, folder, _, _ = env
    api.add_note("Figuren", "Text")
    sync.run_once()
    (folder / "notes" / "Figuren.md").unlink()
    sync.run_once()
    assert (folder / "notes" / "Figuren.md").exists()  # notes are deleted in the app
    del api.notes["note-1"]
    sync.run_once()
    assert not (folder / "notes" / "Figuren.md").exists()
    assert (folder / "notes" / "deleted" / "Figuren.md").read_text().count("Text") == 1


def test_changed_on_both_sides_the_app_wins_and_yours_is_kept(env):
    api, sync, folder, _, log = env
    api.add_note("Figuren", "Alt")
    sync.run_once()
    path = folder / "notes" / "Figuren.md"
    path.write_text(path.read_text().replace("\nAlt\n", "\nMeins\n"))
    age(path, 5)
    api.notes["note-1"].update(markdown="Aus der App", updated_at=api._tick())
    sync.run_once()
    assert "Aus der App" in path.read_text()
    [copy] = (folder / "notes" / "conflicts").iterdir()
    assert "Meins" in copy.read_text() and "conflict" in copy.name
    assert any("conflicts/" in line for line in log)
    assert api.notes["note-1"]["markdown"] == "Aus der App"


def test_a_change_in_the_app_during_a_push_is_a_conflict_not_a_loss(env):
    api, sync, folder, _, _ = env
    api.add_note("Figuren", "Alt")
    sync.run_once()
    path = folder / "notes" / "Figuren.md"
    path.write_text(path.read_text().replace("\nAlt\n", "\nMeins\n"))
    age(path, 5)
    # the app's edit lands after the sync read the notes: the PATCH finds a newer version (409)
    real_get = api.get

    def get_then_edit(p):
        result = real_get(p)
        if p == "/api/notes":
            api.notes["note-1"].update(markdown="Gleichzeitig", updated_at=api._tick())
        return result
    api.get = get_then_edit
    sync.run_once()
    assert "Gleichzeitig" in path.read_text()
    assert "Meins" in next((folder / "notes" / "conflicts").iterdir()).read_text()
    assert api.notes["note-1"]["markdown"] == "Gleichzeitig"  # the app's version wasn't overwritten
    api.get = real_get
    assert sync.run_once()["notes"] == 0  # settled


def test_a_server_error_on_saving_keeps_the_edit_for_the_next_round(env):
    api, sync, folder, _, log = env
    api.add_note("Figuren", "Alt")
    sync.run_once()
    path = folder / "notes" / "Figuren.md"
    path.write_text(path.read_text().replace("\nAlt\n", "\nMeins\n"))
    age(path, 5)
    api.patch_fails = ToolError("HTTP 500: Internal Server Error", 500)
    sync.run_once()
    assert any("500" in line for line in log)
    assert "Meins" in path.read_text() and not list((folder / "notes" / "conflicts").iterdir())
    api.patch_fails = None
    sync.run_once()
    assert api.notes["note-1"]["markdown"] == "Meins"


def test_a_file_still_being_written_waits(env):
    api, sync, folder, now, _ = env
    api.add_note("Figuren", "Alt")
    sync.run_once()
    path = folder / "notes" / "Figuren.md"
    path.write_text(path.read_text().replace("\nAlt\n", "\nMei\n"))
    age(path, 0.5)
    sync.run_once()
    assert api.notes["note-1"]["markdown"] == "Alt"
    now[0] += 5
    sync.run_once()
    assert api.notes["note-1"]["markdown"] == "Mei"


def test_a_network_failure_is_retried_next_round_without_losing_anything(env):
    api, sync, folder, _, log = env
    api.drops = [drop(1, "text", "hello")]
    api.down = True
    assert sync.run_once() == {"inbox": 0, "outbox": 0, "notes": 0}
    assert any("network is down" in line for line in log)
    api.down = False
    assert sync.run_once()["inbox"] == 1


def test_the_state_survives_a_restart(env, tmp_path):
    api, sync, folder, now, _ = env
    api.add_note("Figuren", "Text")
    sync.run_once()
    again = Sync(api, folder, tmp_path / "state.json", log=lambda _: None, clock=lambda: now[0],
                 projects_path=tmp_path / "projects.json")
    assert again.run_once()["notes"] == 0


def test_install_writes_a_user_service_and_uninstall_removes_it(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda args, check: calls.append(args))
    sync_module.install(Path("~/pico"), 15)
    unit = tmp_path / "systemd" / "user" / "pico-reader-sync.service"
    text = unit.read_text()
    assert f"sync --folder {Path.home() / 'pico'} --interval 15" in text and "Restart=on-failure" in text
    assert "PYTHONUNBUFFERED=1" in text  # the log reaches journalctl as it happens
    assert ["systemctl", "--user", "enable", "--now", "pico-reader-sync.service"] in calls
    sync_module.uninstall()
    assert not unit.exists() and ["systemctl", "--user", "disable", "--now", "pico-reader-sync.service"] in calls


def test_run_once_does_one_round(tmp_path, monkeypatch):
    monkeypatch.setattr(sync_module, "Sync", lambda api, folder: Sync(api, folder, tmp_path / "state.json",
                                                                     projects_path=tmp_path / "projects.json"))
    api = FakeApi()
    api.drops = [drop(1, "text", "hello")]
    sync_module.run(api, tmp_path / "pico", 15, once=True)
    assert api.delivered == ["drop-1"]


# --- projects ---

@pytest.fixture
def project(env, tmp_path):
    api, sync, *_ = env
    folder = tmp_path / "code" / "rust-book"
    folder.mkdir(parents=True)
    p = sync_module.project_add(api, folder, projects_path=tmp_path / "projects.json")
    return p["id"], folder


def test_adding_a_project_links_the_folder_and_reuses_the_apps_project(env, tmp_path, project):
    api, *_ = env
    pid, folder = project
    assert api.projects == {pid: "rust-book"} and (folder / "notes").is_dir() and (folder / "inbox").is_dir()
    again = sync_module.project_add(api, folder, name="Rust Book", projects_path=tmp_path / "projects.json")
    assert again["id"] == pid and api.projects == {pid: "Rust Book"}  # the same folder: renamed
    other = tmp_path / "laptop-copy"
    other.mkdir()
    assert sync_module.project_add(api, other, name="rust book", projects_path=tmp_path / "projects.json")["id"] == pid
    listed = sync_module.project_list(api, tmp_path / "projects.json")
    assert listed == [{"id": pid, "name": "Rust Book", "notes": 0, "path": str(other.resolve())}]
    with pytest.raises(ToolError):
        sync_module.project_add(api, tmp_path / "nowhere", projects_path=tmp_path / "projects.json")


def test_a_projects_notes_and_sent_items_live_in_its_folder(env, project):
    api, sync, folder, _, _ = env
    pid, proj = project
    api.add_note("Ownership", "Moves.", project_id=pid)
    api.add_note("Allgemein", "Text")
    api.drops = [drop(1, "snippet", "fn main() {}", language="rust", title="Hello") | {"project_id": pid},
                 drop(2, "text", "anything") | {"project_id": "proj-not-here"}]
    sync.run_once()
    assert "Moves." in (proj / "notes" / "Ownership.md").read_text()
    assert (folder / "notes" / "Allgemein.md").exists() and not (folder / "notes" / "Ownership.md").exists()
    [snippet] = (proj / "inbox").iterdir()
    assert snippet.suffix == ".rs"
    assert len(list((folder / "inbox").iterdir())) == 1  # a project not on this computer: the general inbox
    new = proj / "notes" / "Borrowing.md"
    new.write_text("# Borrowing\n\n&x\n")
    age(new, 5)
    sync.run_once()
    assert next(n for n in api.notes.values() if n["title"] == "Borrowing")["project_id"] == pid


def test_moving_a_note_in_the_app_moves_its_file_and_moving_the_file_moves_the_note(env, project):
    api, sync, folder, _, log = env
    pid, proj = project
    note = api.add_note("Ownership", "Moves.")
    sync.run_once()
    api.move(note["id"], pid)
    sync.run_once()
    assert (proj / "notes" / "Ownership.md").exists() and not (folder / "notes" / "Ownership.md").exists()
    (proj / "notes" / "Ownership.md").rename(folder / "notes" / "Ownership.md")  # e.g. with mv, or in the file manager
    sync.run_once()
    assert api.notes[note["id"]]["project_id"] is None
    assert any("project (none)" in line for line in log)
    assert sync.run_once()["notes"] == 0  # settled


def test_removing_a_project_brings_its_notes_back_to_the_general_folder(env, tmp_path, project):
    api, sync, folder, _, _ = env
    pid, proj = project
    api.add_note("Ownership", "Moves.", project_id=pid)
    sync.run_once()
    sync_module.project_remove(api, proj, delete=True, projects_path=tmp_path / "projects.json")
    assert api.projects == {} and api.notes["note-1"]["project_id"] is None
    sync.run_once()
    assert (folder / "notes" / "Ownership.md").exists()
    with pytest.raises(ToolError):
        sync_module.project_remove(api, proj, projects_path=tmp_path / "projects.json")


def test_notes_are_fetched_only_when_something_changed(env):
    api, sync, folder, _, _ = env
    api.add_note("Figuren", "Text")
    sync.run_once()
    api.calls.clear()
    sync.run_once()
    sync.run_once()
    assert api.calls == ["/api/computer/poll", "/api/computer/poll"]  # nothing new: one small question each
    api.notes["note-1"].update(markdown="Neu", updated_at=api._tick())
    sync.run_once()
    assert "/api/notes" in api.calls and "Neu" in (folder / "notes" / "Figuren.md").read_text()


def test_a_file_saved_here_starts_a_round_within_seconds(tmp_path, monkeypatch):
    """The service's loop: a round every `interval`, and one right after a file here changes and settles."""
    api = FakeApi()
    monkeypatch.setattr(sync_module, "Sync", lambda api, folder: Sync(api, folder, tmp_path / "state.json",
                                                                     log=lambda _: None, projects_path=tmp_path / "projects.json"))
    now = [1_900_000_000.0]
    ticks = []

    class Clock:
        @staticmethod
        def time():
            return now[0]

        @staticmethod
        def sleep(seconds):
            now[0] += seconds
            ticks.append(now[0])
            if len(ticks) == 3:  # a note saved in vim, 3 s into a 60 s interval
                path = tmp_path / "pico" / "notes" / "Neu.md"
                path.write_text("# Neu\n\nText\n")
                os.utime(path, (now[0], now[0]))
            if len(ticks) == 12:
                raise KeyboardInterrupt

    monkeypatch.setattr(sync_module, "time", Clock)
    monkeypatch.setattr(sync_module, "STABLE_SECONDS", 2)
    monkeypatch.setattr(Sync, "_stable", lambda self, p: now[0] - p.stat().st_mtime >= 2)
    with pytest.raises(KeyboardInterrupt):
        sync_module.run(api, tmp_path / "pico", 60, once=False)
    assert [n["title"] for n in api.notes.values()] == ["Neu"]  # long before the next 60 s round


def test_items_sent_to_the_running_file_are_added_at_its_end(env, project):
    api, sync, folder, _, _ = env
    pid, proj = project
    api.drops = [drop(1, "highlight", "Der Alarm kam.", meta={"book_title": "Die Wolke", "heading": "Kapitel 1"}) | {"append": True},
                 drop(2, "snippet", "print('```')", language="python", title="Fences") | {"append": True}]
    sync.run_once()
    api.drops += [drop(3, "text", "Noch eins") | {"append": True}, drop(4, "text", "own file")]
    sync.run_once()
    journal = (folder / "inbox" / "journal.md").read_text()
    assert journal.startswith("# Journal\n")
    assert journal.index("Der Alarm") < journal.index("print(") < journal.index("Noch eins")  # newest at the end
    assert "## " in journal and "Die Wolke · Kapitel 1 · highlight" in journal and "> Der Alarm kam." in journal
    assert "````python\nprint('```')\n````" in journal  # code fenced, even code with fences in it
    assert [p.name for p in (folder / "inbox").iterdir() if p.name != "journal.md"][0].endswith("text.md")
    api.drops += [drop(5, "text", "for the project") | {"append": True, "project_id": pid}]
    sync.run_once()
    assert "for the project" in (proj / "inbox" / "journal.md").read_text()
