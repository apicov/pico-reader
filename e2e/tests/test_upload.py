"""Adding several books at once: a folder holding marker projects (each its own folder: .md, _meta.json, page images,
an EPUB exported from it), and several files chosen together."""

import re
import struct
import zlib

from conftest import WEB, until

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


def test_a_folder_of_marker_projects_becomes_several_books(page, api, tmp_path):
    books = tmp_path / "converted_markdown"
    marker_project(books, "Erste Probe (Anna Autor) (Z-Library)", "Erstes Kapitel")
    marker_project(books, "Zweite Probe (Berg, Otto) (Z-Library)", "Anfang")
    page.goto(f"{WEB}/#/upload")
    page.locator("input[webkitdirectory]").set_input_files(books)
    first, second = page.get_by_label("Title").nth(0), page.get_by_label("Title").nth(1)
    until(lambda: first.input_value() == "Erste Probe" and second.input_value() == "Zweite Probe", what="both books listed")
    assert page.get_by_label("Author").nth(1).input_value() == "Otto Berg"
    page.get_by_role("button", name="Upload 2 books").click()  # the language was guessed: German
    until(lambda: page.get_by_text("Added. The server is making it searchable.").count() == 2, timeout=30,
          what="both uploaded")

    library = {b["title"]: b for b in api.get("/api/library").json()["books"]}
    assert library["Erste Probe"]["author"] == "Anna Autor" and library["Erste Probe"]["language"] == "de"
    assert "reflow" in library["Zweite Probe"]["formats"] and "epub" not in library["Zweite Probe"]["formats"]

    page.get_by_role("button", name="Open").first.click()
    page.get_by_text("Der Alarm kam am Vormittag").first.wait_for()
    body = page.locator(".reflow").inner_text()
    assert "------" not in body and "<packt>" in body  # the page lines are gone; the stray tag is text
    assert page.locator(".reflow img").first.evaluate("img => img.complete && img.naturalWidth") == 4

    # choosing the same folder again: they're in the library already, so nothing is selected
    page.goto(f"{WEB}/#/upload")
    page.locator("input[webkitdirectory]").set_input_files(books)
    page.get_by_text(re.compile("in the library or the list already")).first.wait_for()
    assert page.get_by_role("button", name="Upload 0 books").is_disabled()


def test_several_files_chosen_together_are_all_listed(page, tmp_path):
    files = []
    for name in ("Notizen Eins", "Notizen Zwei", "Notizen Drei"):
        path = tmp_path / f"{name}.md"
        path.write_text(f"# {name}\n\n{PROSE}\n")
        files.append(path)
    page.goto(f"{WEB}/#/upload")
    page.locator('input[type="file"][multiple]').set_input_files(files)
    until(lambda: sorted(page.get_by_label("Title").nth(i).input_value() for i in range(3))
          == ["Notizen Drei", "Notizen Eins", "Notizen Zwei"], what="three books listed")
    page.get_by_role("button", name="Upload 3 books").wait_for()
