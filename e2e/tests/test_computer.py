"""Sending from the app to the study computer, and back, with the real desktop tool (`reader sync --once`)."""
import json
import os
import re
import subprocess
from pathlib import Path

from conftest import API, WEB, until
from test_reader import open_book, select_first_paragraph

TOOLS = Path(__file__).resolve().parents[2] / "tools"


def tool(tmp_path: Path, token: str, *args: str) -> str:
    """The desktop tool, signed in as the e2e reader, with its config and state in tmp_path."""
    config = tmp_path / "config"
    (config / "pico-reader").mkdir(parents=True, exist_ok=True)
    (config / "pico-reader" / "tool.json").write_text(json.dumps({"server": API, "token": token}))
    env = {**os.environ, "XDG_CONFIG_HOME": str(config), "XDG_STATE_HOME": str(tmp_path / "state")}
    done = subprocess.run([str(TOOLS / "reader"), *args], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


def sync_once(tmp_path: Path, token: str, folder: Path) -> str:
    return tool(tmp_path, token, "sync", "--once", "--folder", str(folder))


def test_a_selection_sent_from_the_book_arrives_in_the_inbox_and_an_outbox_file_becomes_a_note(page, api, book_id, tmp_path):
    frame = open_book(page, book_id)
    select_first_paragraph(frame)
    page.get_by_label("Send to computer").click()
    page.get_by_role("button", name="New file").click()
    page.get_by_role("button", name=re.compile("^Inbox")).click()
    page.get_by_text("Sent to your computer (inbox)").wait_for()
    token = api.headers["Authorization"].removeprefix("Bearer ")
    folder = tmp_path / "pico"
    sync_once(tmp_path, token, folder)
    [arrived] = list((folder / "inbox").glob("*Die Wolke (Probe) – highlight.md"))
    text = arrived.read_text()
    assert "book: Die Wolke (Probe)" in text and "> Der Alarm kam am Vormittag" in text

    (folder / "outbox" / "Frage.md").write_text("Warum ist es still in der Klasse?\n")
    os.utime(folder / "outbox" / "Frage.md", (0, 0))  # long since saved
    sync_once(tmp_path, token, folder)
    assert (folder / "outbox" / "sent" / "Frage.md").exists()
    note = until(lambda: next((n for n in api.get("/api/notes").json() if n["title"] == "Frage"), None),
                 what="the note from the computer")
    assert note["origin"] == "computer"
    # and it's in the app's Notes, and in notes/ on the computer at the next round
    page.goto(f"{WEB}/#/notes")
    page.get_by_text("Frage").first.wait_for()
    sync_once(tmp_path, token, folder)
    assert "Warum ist es still" in (folder / "notes" / "Frage.md").read_text()


def test_a_project_folder_keeps_its_notes_live_and_gets_what_is_sent_to_it(page, api, book_id, tmp_path):
    token = api.headers["Authorization"].removeprefix("Bearer ")
    folder, project = tmp_path / "pico", tmp_path / "code" / "rust-book"
    project.mkdir(parents=True)
    assert "project “rust-book”" in tool(tmp_path, token, "project", "add", str(project))
    note = api.post("/api/notes", json={"title": "Ownership", "markdown": "Each value has one owner."}).json()

    # filed in the project in the app: its file is in the project's notes/
    page.goto(f"{WEB}/#/notes/{note['id']}")
    page.get_by_text("Each value has one owner.").wait_for()
    page.get_by_label("Note actions").click()
    page.get_by_role("menuitem", name="Project…").click()
    page.get_by_role("button", name=re.compile("^rust-book")).click()
    page.get_by_text("rust-book ·").wait_for()
    sync_once(tmp_path, token, folder)
    path = project / "notes" / "Ownership.md"
    assert "Each value has one owner." in path.read_text() and not (folder / "notes" / "Ownership.md").exists()

    # edited on the computer: the open note in the app follows within seconds, without a reload
    path.write_text(path.read_text().replace("Each value has one owner.", "Each value has exactly one owner (edited in vim)."))
    os.utime(path, (0, 0))
    sync_once(tmp_path, token, folder)
    page.get_by_text("exactly one owner (edited in vim)").wait_for(timeout=10_000)

    # sent from the book into the project's running file, twice: one file, both in order
    frame = open_book(page, book_id)
    for _ in range(2):
        select_first_paragraph(frame)
        page.get_by_label("Send to computer").click()
        page.get_by_role("button", name="Running file").click()
        page.get_by_role("button", name=re.compile("^rust-book")).click()
        page.get_by_text("Sent to your computer (rust-book, journal.md)").wait_for()
        page.get_by_text("Sent to your computer (rust-book, journal.md)").wait_for(state="hidden")
    sync_once(tmp_path, token, folder)
    assert [p.name for p in (project / "inbox").iterdir()] == ["journal.md"]
    journal = (project / "inbox" / "journal.md").read_text()
    assert journal.count("> Der Alarm kam am Vormittag") == 2 and journal.count("· highlight") == 2
