"""Adding several books at once: a folder holding marker projects (each its own folder: .md, _meta.json, page images,
an EPUB exported from it), and several files chosen together."""

import re

from helpers import PROSE, WEB, marker_project, until


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
