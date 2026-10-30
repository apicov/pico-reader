"""The user manual's screenshots (frontend/public/manual/<name>.webp), taken from the real app with the e2e setup:

    E2E_TESTS=tests/manual_capture.py e2e/run.sh

Not part of the e2e suite (the file name doesn't start with test_). It adds books, a collection, projects and notes,
reading time, a review card and a review through the API, then takes each picture in a fresh browser. The names
must match the manual's <Screenshot name="…"> (frontend/src/components/manual/content/); ManualPage.test.tsx checks
that every picture exists."""

import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from PIL import Image, ImageDraw, ImageFont

from conftest import AI, API, WEB, until
from test_reader import FIRST, open_book, select_first_paragraph
from test_upload import marker_project

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "manual"
PHONE = {"width": 390, "height": 844}
TABLET = {"width": 1180, "height": 820}


def call(name, args, cid="c1"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def script(agent=None, json_replies=None):
    if agent is not None:
        httpx.post(f"{AI}/script", json=agent).raise_for_status()
    if json_replies is not None:
        httpx.post(f"{AI}/script-json", json=json_replies).raise_for_status()


def save(png: bytes, name: str, width: int | None = None) -> None:
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if width and image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    image.save(OUT / f"{name}.webp", "WEBP", quality=80, method=6)


# --- data ---

def cover(title: str, author: str, colour: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", (400, 600), colour)
    draw = ImageDraw.Draw(image)
    try:
        big = ImageFont.truetype("/usr/share/fonts/liberation-serif-fonts/LiberationSerif-Bold.ttf", 46)
        small = ImageFont.truetype("/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf", 26)
    except OSError:
        big = small = ImageFont.load_default()
    y = 170
    for line in re.findall(r".{1,14}(?:\s|$)", title):
        draw.text((36, y), line.strip(), fill=(250, 246, 236), font=big)
        y += 56
    draw.text((36, 500), author, fill=(235, 228, 210), font=small)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def epub(title: str, author: str, language: str, chapters: list[tuple[str, str]],
         images: dict[str, bytes] | None = None) -> bytes:
    page = lambda heading, body: f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="{language}"><head><title>{heading}</title></head><body>
<h1>{heading}</h1>{body}</body></html>"""
    items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
    items += "".join(f'<item id="img{i}" href="{name}" media-type="image/png"/>' for i, name in enumerate(images or {}))
    spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    toc = "".join(f'<li><a href="c{i}.xhtml">{h}</a></li>' for i, (h, _) in enumerate(chapters))
    files = {
        "META-INF/container.xml": """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""",
        "OEBPS/content.opf": f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">{uuid.uuid4()}</dc:identifier>
<dc:title>{title}</dc:title><dc:language>{language}</dc:language><dc:creator>{author}</dc:creator>
<meta property="dcterms:modified">2026-10-25T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest>
<spine>{spine}</spine></package>""",
        "OEBPS/nav.xhtml": f"""<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"
xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>{toc}</ol></nav></body></html>""",
        **{f"OEBPS/c{i}.xhtml": page(h, b) for i, (h, b) in enumerate(chapters)},
    }
    files.update({f"OEBPS/{name}": data for name, data in (images or {}).items()})
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")
        for name, content in files.items():
            z.writestr(name, content, compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()


def add_book(api: httpx.Client, title: str, author: str, language: str, colour, chapters, images=None) -> str:
    blobs = {"epub": (epub(title, author, language, chapters, images), "application/epub+zip"),
             "cover": (cover(title, author, colour), "image/png")}
    files = {k: {"size": len(b), "sha256": hashlib.sha256(b).hexdigest(), "content_type": t} for k, (b, t) in blobs.items()}
    book = api.post("/api/books", json={"title": title, "author": author, "language": language, "files": files}).json()
    for kind, url in book["uploads"].items():
        httpx.put(url, content=blobs[kind][0], headers={"Content-Type": blobs[kind][1]}).raise_for_status()
    api.post(f"/api/books/{book['id']}/commit").raise_for_status()
    return book["id"]


PYTHON = """<p>A list comprehension builds a new list from an iterable, in one readable expression:</p>
<pre><code class="language-python">symbols = '$¢£¥€¤'
codes = [ord(symbol) for symbol in symbols]
print(codes)</code></pre><p>It's faster than a loop that appends, and it says what it means.</p>""" * 3
TAU = "<p>The Leonora Christine left the solar system with fifty people aboard.</p>" * 20


def at(days_ago: int, hour: int) -> str:
    return (datetime.now(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0)
            - timedelta(days=days_ago)).isoformat()


@pytest.fixture(scope="module")
def world(api, book_id):
    """Books, shelf and a collection, projects and notes, reading time, a review card, a profile and a review."""
    fluent = add_book(api, "Fluent Python", "Luciano Ramalho", "en", (36, 74, 112),
                      [("2 An Array of Sequences", PYTHON), ("3 Dictionaries and Sets", PYTHON)])
    tau = add_book(api, "Tau Zero", "Poul Anderson", "en", (120, 52, 40), [("Chapter 1", TAU), ("Chapter 2", TAU)])
    ok = lambda r: r.raise_for_status()
    for b in (fluent, tau, book_id):
        ok(api.put(f"/api/shelf/mine/{b}"))
    api.put("/api/shelf/collections/col-manual-uni", json={"name": "Uni", "position": 0})
    api.put("/api/shelf/collections/col-manual-novels", json={"name": "Novels", "position": 1})
    api.put(f"/api/shelf/collections/col-manual-uni/books/{fluent}")
    api.put(f"/api/shelf/collections/col-manual-novels/books/{tau}")
    api.put(f"/api/shelf/collections/col-manual-novels/books/{book_id}")

    rust = "proj-manual-rust-book"
    api.put(f"/api/projects/{rust}", json={"name": "rust-book"})
    api.put("/api/projects/proj-manual-thesis", json={"name": "thesis"})
    for title, markdown, project in [
        ("Ownership", "## Ownership\n\n- Each value has **one owner**.\n- When the owner goes out of scope, the value is dropped.", rust),
        ("Borrowing", "## Borrowing\n\n`&x` borrows, `&mut x` borrows mutably: one or the other, never both.", rust),
        ("Die Wolke: Figuren", "## Figuren\n\n- **Janna-Berta**, 14\n- **Uli**, her brother", None),
    ]:
        api.post("/api/notes", json={"title": title, "markdown": markdown, "project_id": project})

    sessions = [{"id": f"sess-manual-{d:02d}", "book_id": [book_id, fluent, tau][d % 3], "format": "epub",
                 "started_at": at(d, 20), "ended_at": at(d, 20), "seconds": 600 + (d * 397) % 1800,
                 "progress_start": 0.02 * d, "progress_end": 0.02 * d + 0.02} for d in range(0, 13) if d not in (4, 9)]
    api.post("/api/events", json={"sessions": sessions}).raise_for_status()
    ok(api.put("/api/review-cards/card-manual-0001", json={
        "language": "de", "term": "die Mühe", "meaning": "el esfuerzo", "example": "Sie hatten Mühe, still zu sitzen.",
        "state": {}, "due": at(1, 8), "client_updated_at": at(2, 8)}))  # empty: a new card, as the chat makes them

    ok(api.get("/api/profiles/me"))
    ok(api.put("/api/profiles/me", json={"handle": "pico", "display_name": "Pico"}))
    ok(api.put(f"/api/books/{tau}/review", json={"score": 9, "recommend": True,
                                                 "body": "Hard science fiction at its best: the ship can't stop, and time runs away."}))
    ok(api.post("/api/posts", json={"title": "The ending of Tau Zero", "book_ids": [tau],
                                   "body": "Did anyone else find the last chapter hopeful rather than sad? ||The new universe||…"}))
    return {"fluent": fluent, "tau": tau}


@pytest.fixture
def phone(browser, signed_in):
    context = browser.new_context(storage_state=signed_in, viewport=PHONE, device_scale_factor=2)
    yield context.new_page()
    context.close()


@pytest.fixture
def tablet(browser, signed_in):
    context = browser.new_context(storage_state=signed_in, viewport=TABLET, device_scale_factor=1.5)
    yield context.new_page()
    context.close()


def shot(page, name, width=720, **kw):
    page.wait_for_timeout(600)  # transitions settle
    save(page.screenshot(**kw), name, width)


# --- the pictures ---

def test_login(browser):
    context = browser.new_context(viewport=PHONE, device_scale_factor=2)
    page = context.new_page()
    page.goto(WEB)
    page.get_by_label("Email").fill("you@example.com")
    shot(page, "login")
    context.close()


def test_library_and_menus(world, phone, tablet):
    tablet.goto(WEB)
    tablet.get_by_text("Fluent Python").first.wait_for()
    shot(tablet, "topbar", width=1180, clip={"x": 0, "y": 0, "width": TABLET["width"], "height": 74})

    phone.goto(WEB)
    phone.get_by_role("tab", name=re.compile("All books")).click()
    phone.get_by_text("Tau Zero").first.wait_for()
    phone.wait_for_timeout(1200)  # covers
    shot(phone, "library")
    phone.get_by_label("Tau Zero: shelf").click()
    shot(phone, "book-menu")
    phone.keyboard.press("Escape")
    phone.get_by_role("tab", name=re.compile("My shelf")).click()
    phone.get_by_role("button", name="Open Novels").wait_for()
    phone.wait_for_timeout(1200)  # covers
    shot(phone, "shelf")


def test_reading(world, phone, book_id, browser, signed_in):
    frame = open_book(phone, book_id)
    shot(phone, "reader")
    select_first_paragraph(frame)
    phone.get_by_label("Highlight").click()
    phone.get_by_label("Contents").click()
    phone.get_by_role("tab", name=re.compile("Notes")).click()
    shot(phone, "contents-notes")
    phone.keyboard.press("Escape")
    phone.get_by_label("Text settings").click()
    popover = phone.locator(".MuiPopover-paper")
    popover.wait_for()
    phone.wait_for_timeout(500)
    save(popover.screenshot(), "text-settings", 560)
    phone.keyboard.press("Escape")

    script(json_replies=[{"translation": "La alarma llegó por la mañana, cuando Janna-Berta todavía estaba en la escuela.",
                          "notes": "«saß» es el pasado de «sitzen»: estar sentado.",
                          "vocabulary": [{"term": "der Alarm", "meaning": "la alarma"}, {"term": "sitzen", "meaning": "estar sentado"}],
                          "detected_language": "de"}])
    select_first_paragraph(frame)
    phone.get_by_role("button", name=re.compile("Translate into")).click()
    phone.get_by_text("La alarma llegó").wait_for(timeout=15_000)
    shot(phone, "selection")

    night = browser.new_context(storage_state=signed_in, viewport=PHONE, device_scale_factor=2)
    page = night.new_page()
    page.goto(f"{WEB}/#/settings")
    page.get_by_role("button", name="Night").click()
    open_book(page, book_id)
    shot(page, "night")
    night.close()


def test_send_dialog(world, phone):
    phone.goto(f"{WEB}/#/read/{world['fluent']}")
    frame = until(lambda: next((f for f in phone.frames if f.locator("text=list comprehension").count()), None), timeout=30)
    frame.evaluate("""() => {
        const code = document.querySelector('pre code');
        const range = document.createRange(); range.selectNodeContents(code);
        const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }""")
    phone.get_by_label("Send to computer").click()
    phone.get_by_text("Send to your computer").wait_for()
    shot(phone, "send")


def test_words(world, phone):
    phone.goto(f"{WEB}/#/review")
    phone.get_by_role("button", name="Show answer").click()
    shot(phone, "review")
    phone.goto(f"{WEB}/#/dictionary?tab=history")
    phone.get_by_text("La alarma llegó").first.wait_for(timeout=15_000)
    shot(phone, "translations")
    script(json_replies=[
        {"_match": "German–Spanish", "lemma": "das Strahlenschutzgesetz", "part_of_speech": "sustantivo",
         "meaning": "ley de protección radiológica",
         "notes": "compuesto de Strahlenschutz + Gesetz"},
        {"_match": "monolingual German", "lemma": "das Strahlenschutzgesetz", "part_of_speech": "Substantiv",
         "meaning": "Gesetz, das Menschen und Umwelt vor ionisierender Strahlung schützt", "notes": ""}])
    phone.goto(f"{WEB}/#/dictionary?lang=de&w=Strahlenschutzgesetzes")
    phone.get_by_text("ionisierender Strahlung").wait_for(timeout=15_000)
    phone.get_by_text("ley de protección radiológica").wait_for()
    shot(phone, "dictionary")


def test_ask(world, phone):
    script(json_replies=[{"title": "Reading this week"}] * 3)
    script(agent=[call("reading_stats", {"period": "week"}),
                  {"role": "assistant", "content": "This week you read **2 h 40 min** on 5 days, most of it in *Fluent Python*. "
                                                   "At your pace you'll finish it in about **6 hours**."}])
    phone.goto(f"{WEB}/#/ask")
    phone.get_by_placeholder("Ask about your books…").fill("How much did I read this week?")
    phone.get_by_label("Send").click()
    phone.get_by_text("At your pace").wait_for(timeout=20_000)
    shot(phone, "ask")
    script(agent=[call("save_note", {"title": "Fluent Python: sequences", "book": "Fluent Python",
                                     "markdown": "## Sequences\n\n- **List comprehensions** build lists in one expression.\n"
                                                 "- **Tuples** are records, not only immutable lists.\n\n"
                                                 "```mermaid\nflowchart LR\n  S[Sequences] --> L[list]\n  S --> T[tuple]\n  S --> A[array]\n```\n"}),
                  {"role": "assistant", "content": "I proposed a note: confirm to keep it."}])
    phone.get_by_placeholder("Ask a follow-up…").fill("Make me a note about sequences, with a diagram")
    phone.get_by_label("Send").click()
    phone.get_by_text("Save note: Fluent Python: sequences").wait_for(timeout=20_000)
    phone.get_by_role("button", name="Show the note").click()
    phone.locator(".diagram svg").first.wait_for(state="attached", timeout=40_000)
    phone.get_by_role("button", name="Confirm").scroll_into_view_if_needed()
    shot(phone, "ask-confirm")


def test_notes(world, phone):
    phone.goto(f"{WEB}/#/notes")
    phone.get_by_role("button", name=re.compile(r"^rust-book")).click()
    phone.get_by_text("Ownership").first.wait_for()
    shot(phone, "notes")
    phone.get_by_role("link", name="New note").click()
    phone.get_by_label("Title").fill("Lifetimes")
    phone.get_by_label("Markdown").fill("## Lifetimes\n\nA reference must not **outlive** the value it points to.\n\n"
                                        "```rust\nfn longest<'a>(x: &'a str, y: &'a str) -> &'a str\n```")
    shot(phone, "note-new")


def test_more_pages(world, phone, tmp_path):
    phone.goto(f"{WEB}/#/stats")
    phone.get_by_text("Today").first.wait_for()
    phone.wait_for_timeout(1000)
    shot(phone, "stats")
    phone.goto(f"{WEB}/#/book/{world['tau']}")
    phone.get_by_text("The ending of Tau Zero").wait_for()
    shot(phone, "book-page")
    phone.goto(f"{WEB}/#/settings")
    phone.get_by_role("button", name="Night").wait_for()
    shot(phone, "settings")

    books = tmp_path / "converted_markdown"
    marker_project(books, "Concrete Mathematics (Graham, Knuth, Patashnik) (Z-Library)", "Recurrent Problems")
    marker_project(books, "How to Solve It (George Polya) (Z-Library)", "In the Classroom")
    phone.goto(f"{WEB}/#/upload")
    phone.locator("input[webkitdirectory]").set_input_files(books)
    until(lambda: phone.get_by_role("button", name="Upload 2 books").is_enabled(), what="both listed")
    shot(phone, "upload")
