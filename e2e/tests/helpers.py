"""What the tests share: where the servers are, waiting for something to happen, the fake AI's script, opening the
seeded book and selecting its first paragraph, a marker project folder."""

import os
import struct
import time
import zlib
from pathlib import Path

import httpx

WEB = os.environ["E2E_WEB"]
API = os.environ["E2E_API"]
AI = os.environ["E2E_AI"]
API_LOG = Path(os.environ["E2E_API_LOG"])
EMAIL = "reader@example.com"
TITLE = "Die Wolke (Probe)"


def script_ai(*messages: dict) -> None:
    """The fake AI's next agent replies, in order."""
    httpx.post(f"{AI}/script", json=list(messages)).raise_for_status()


def until(check, timeout=10.0, what="the condition"):
    """Polls `check()` until it's truthy (sync to the server happens in the background)."""
    end = time.time() + timeout
    while time.time() < end:
        if (result := check()):
            return result
        time.sleep(0.25)
    raise AssertionError(f"Timed out waiting for {what}")


FIRST = "Der Alarm kam am Vormittag"


def open_book(page, book_id):
    page.goto(f"{WEB}/#/read/{book_id}")
    return until(lambda: next((f for f in page.frames if f.locator(f"text={FIRST}").count()), None),
                 timeout=30, what="the book's text")


def select_first_paragraph(frame):
    frame.evaluate("""() => {
        const p = [...document.querySelectorAll('p')].find((x) => x.textContent.startsWith('Der Alarm'));
        const range = document.createRange(); range.selectNodeContents(p);
        const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }""")


PROSE = ("Der Alarm kam am Vormittag, als Janna-Berta noch in der Schule saß, und die Lehrerin las die Durchsage vor. "
         "Es ist nicht so, dass sie mit dem Bus nach Hause fuhr. ") * 8


def png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x90\x40\x20" * 4) * 4)) + chunk(b"IEND", b""))


def marker_project(root, name: str, heading: str) -> None:
    folder = root / name
    folder.mkdir(parents=True)
    (folder / f"{name}.md").write_text(
        f"{{0}}------------------------------------------------\n\n# {heading}\n\n{PROSE}\n\n"
        "![](_page_1_Picture_0.png)\n\n<packt>\n\n"
        "{1}------------------------------------------------\n\n"
        f"# Kapitel Zwei\n\n{PROSE}\n")
    (folder / f"{name}_meta.json").write_text('{"table_of_contents": []}')
    (folder / "_page_1_Picture_0.png").write_bytes(png())
    (folder / f"{name}.epub").write_bytes(b"PK an export of the same book")
