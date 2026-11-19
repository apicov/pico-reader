"""A file opened just to read (docs/19-viewing-a-file.md): shown from memory, not added to the library, nothing kept;
closing it lets it go."""

import zipfile

from helpers import WEB, until


def small_epub(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                   '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        z.writestr("OEBPS/content.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" '
                   'version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   '<dc:identifier id="id">nur-lesen</dc:identifier><dc:title>Nur zum Lesen</dc:title>'
                   '<dc:language>de</dc:language></metadata><manifest>'
                   '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
                   '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>'
                   '<spine><itemref idref="c1"/></spine></package>')
        z.writestr("OEBPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" '
                   'xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>'
                   '<li><a href="c1.xhtml">Eins</a></li></ol></nav></body></html>')
        z.writestr("OEBPS/c1.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" lang="de"><body><h1>Eins</h1>'
                   '<p>Ein Buch, das nur gelesen wird und nicht in die Bibliothek kommt.</p></body></html>')


def test_a_file_opened_just_to_read_isnt_added_or_kept(page, api, tmp_path):
    before = {b["id"] for b in api.get("/api/library").json()["books"]}
    sent = []
    kept = ("/api/books", "/api/progress", "/api/workspaces", "/api/annotations", "/api/shelf")
    page.on("request", lambda r: r.method in ("POST", "PUT") and any(k in r.url for k in kept) and sent.append(r.url))
    path = tmp_path / "nur-lesen.epub"
    small_epub(path)
    page.goto(f"{WEB}/#/upload")
    page.get_by_text("Open a file").locator("input").set_input_files(path)
    page.wait_for_url("**/#/view")
    page.get_by_text("Just reading: not in the library").wait_for()
    frame = until(lambda: next((f for f in page.frames if f.locator("text=Ein Buch, das nur").count()), None),
                  timeout=30, what="the book's text")
    page.get_by_text("Nur zum Lesen").or_(page.get_by_text("Eins")).first.wait_for()

    # selecting text: the panel, without highlighting or sending (there's no book to keep them with)
    frame.evaluate("""() => {
        const range = document.createRange(); range.selectNodeContents(document.querySelector('p'));
        const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }""")
    page.get_by_label("Copy").wait_for()
    assert page.get_by_label("Highlight").count() == 0

    page.get_by_role("button", name="Close the file").click()
    page.wait_for_url("**/#/upload")
    assert {b["id"] for b in api.get("/api/library").json()["books"]} == before
    assert not sent
    # gone: the viewer's address alone has nothing to show
    page.goto(f"{WEB}/#/view")
    page.wait_for_url("**/#/upload")


def test_a_markdown_file_opened_just_to_read(page, tmp_path):
    path = tmp_path / "Notizen.md"
    path.write_text("# Ein Kapitel\n\nNur ein kurzer Text zum Lesen, mit *Betonung*.\n")
    page.goto(f"{WEB}/#/upload")
    page.get_by_text("Open a file").locator("input").set_input_files(path)
    page.locator(".reflow").get_by_text("Nur ein kurzer Text zum Lesen").wait_for(timeout=30_000)
    assert page.locator(".reflow em").inner_text() == "Betonung"
