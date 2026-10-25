"""Sending from the app to the study computer, and back, with the real desktop tool (`reader sync --once`)."""
import json
import os
import subprocess
from pathlib import Path

from conftest import API, WEB, until
from test_reader import open_book, select_first_paragraph

TOOLS = Path(__file__).resolve().parents[2] / "tools"


def sync_once(tmp_path: Path, token: str, folder: Path) -> str:
    config = tmp_path / "config"
    (config / "pico-reader").mkdir(parents=True, exist_ok=True)
    (config / "pico-reader" / "tool.json").write_text(json.dumps({"server": API, "token": token}))
    env = {**os.environ, "XDG_CONFIG_HOME": str(config), "XDG_STATE_HOME": str(tmp_path / "state")}
    done = subprocess.run([str(TOOLS / "reader"), "sync", "--once", "--folder", str(folder)], env=env,
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_a_selection_sent_from_the_book_arrives_in_the_inbox_and_an_outbox_file_becomes_a_note(page, api, book_id, tmp_path):
    frame = open_book(page, book_id)
    select_first_paragraph(frame)
    page.get_by_label("Send to computer").click()
    page.get_by_text("Sent to your computer").wait_for()
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
