import re
import io

from PIL import Image

from conftest import TITLE, WEB, until

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


def test_open_the_book_highlight_and_it_reaches_the_server(page, api, book_id):
    frame = open_book(page, book_id)
    select_first_paragraph(frame)
    page.get_by_label("Highlight").click()
    saved = until(lambda: [a for a in api.get("/api/annotations").json()["annotations"]
                           if a["kind"] == "highlight" and a["book_id"] == book_id and not a["deleted"]],
                  what="the highlight on the server")
    assert saved[0]["text"].startswith(FIRST) and saved[0]["location"].startswith("epubcfi(")
    # still there after a reload (from the device, and in the reader's list)
    page.reload()
    open_book(page, book_id)
    page.get_by_label("Contents").click()
    page.get_by_role("tab", name="Notes (1)").click()
    page.get_by_text(FIRST).first.wait_for()


def test_a_bookmark_made_offline_syncs_when_back_online(page, api, book_id):
    open_book(page, book_id)  # online first: the book is downloaded to the device
    # the service worker controls the page (it serves the app offline)
    page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=30_000)
    page.context.set_offline(True)
    page.reload()
    open_book(page, book_id)
    page.get_by_label("Bookmark this place").click()
    page.get_by_label("Remove bookmark").wait_for()
    assert not [a for a in api.get("/api/annotations").json()["annotations"] if a["kind"] == "bookmark"]
    page.context.set_offline(False)
    page.reload()
    until(lambda: [a for a in api.get("/api/annotations").json()["annotations"]
                   if a["kind"] == "bookmark" and a["book_id"] == book_id], what="the bookmark on the server")


def test_night_theme_leaves_no_blue_anywhere(page):
    page.goto(f"{WEB}/#/settings")
    page.get_by_role("button", name="Night").click()
    page.goto(WEB)
    page.get_by_text(TITLE).first.wait_for()
    page.wait_for_timeout(1500)  # the cover (pure blue) is drawn
    image = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    assert image.getchannel("B").getextrema()[1] == 0
    assert image.getchannel("R").getextrema()[1] > 100  # not just a black screen


def test_night_theme_taps_flash_amber_not_blue(page, book_id):
    """Android paints the tap flash outside the night filter: its own colour must have no blue."""
    page.goto(f"{WEB}/#/settings")
    page.get_by_role("button", name="Night").click()
    frame = open_book(page, book_id)
    tap = "el => getComputedStyle(el).webkitTapHighlightColor"
    for colour in (page.get_by_label("Next page").evaluate(tap), page.get_by_label("Previous page").evaluate(tap),
                   frame.locator("html").evaluate(tap)):
        r, g, b, _ = (float(x) for x in colour.removeprefix("rgba(").removesuffix(")").split(","))
        assert b == 0 and r > g > 0, colour


def test_the_book_stays_open_behind_the_other_pages(page, book_id):
    frame = open_book(page, book_id)
    keep = "document.querySelector('foliate-view')"
    page.evaluate(f"{keep}.stillHere = true")  # gone if the book were opened again
    page.get_by_role("link", name="Ask your library").click()
    page.get_by_text("One book").wait_for()  # a chat started from the book asks about it
    page.get_by_role("link", name="Notes").click()
    page.get_by_role("link", name="Back to the book").click()  # the top bar, on every page
    page.get_by_text("Kapitel 1").first.wait_for()
    assert page.evaluate(f"{keep}.stillHere") is True  # the same book, not loaded again

    # a link to a place in the book (a citation, a quote) moves the open book there
    page.get_by_role("link", name="Notes").click()
    page.evaluate(f"location.hash = '#/read/{book_id}?format=epub&progress=0.9'")
    until(lambda: page.get_by_text("Kapitel 2").count() > 0, timeout=15, what="the book at 90%: chapter 2")
    assert "progress" not in page.url and page.evaluate(f"{keep}.stillHere") is True


def test_math_and_highlighted_code_keep_their_fonts_and_colours(page, book_id):
    """The reading font and the theme's text colour win over the book's own, but math keeps its fonts (KaTeX places
    glyphs by their metrics) and highlighted code and math their colours."""
    for theme, text in (("Paper", "rgb(43, 43, 43)"), ("Dark", "rgb(214, 211, 205)")):
        page.goto(f"{WEB}/#/settings")
        page.get_by_role("button", name=theme).click()
        frame = open_book(page, book_id)
        style = frame.evaluate("""() => {
            const body = document.body;
            body.insertAdjacentHTML('beforeend', `<p id="t-p" style="color:#000;font-family:serif">Text</p>
              <p><span class="katex"><span id="t-katex" class="mord" style="font-family:KaTeX_Main">x</span></span></p>
              <math xmlns="http://www.w3.org/1998/Math/MathML"><mi id="t-mi" mathcolor="#cc0000">x</mi></math>
              <pre id="t-pre"><code><span id="t-kw" class="kw" style="color:#007020">def</span> f</code></pre>`);
            const css = (id) => getComputedStyle(document.getElementById(id));
            return { p: css('t-p').color, pFont: css('t-p').fontFamily, katexFont: css('t-katex').fontFamily,
                     mi: css('t-mi').color, pre: css('t-pre').color, kw: css('t-kw').color };
        }""")
        assert style["p"] == text and style["pFont"].strip('"').startswith("Literata"), (theme, style)
        assert style["katexFont"] == "KaTeX_Main", (theme, style)
        assert style["mi"] == "rgb(204, 0, 0)" and style["kw"] == "rgb(0, 112, 32)", (theme, style)
        assert style["pre"] == text, (theme, style)


def test_notes_open_in_a_popup(page, book_id):
    """Footnotes in asides are hidden in the text: their links show them in a popup instead of jumping there."""
    frame = open_book(page, book_id)
    view = "document.querySelector('foliate-view')"
    for ref, text in (("ref1", "Der Text der Fußnote."), ("ref2", "Der Text der Fußnote."),  # noteref; plain link
                      ("ref3", "Der Text der Endnote.")):  # in another chapter
        frame.locator(f"#{ref}").evaluate("a => a.click()")
        dialog = page.get_by_role("dialog", name="Note")
        dialog.get_by_text(text).wait_for()
        assert "↩" not in dialog.inner_text()  # the link back is left out
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden")
    assert "Kapitel 1" in page.evaluate(f"{view}.lastLocation?.tocItem?.label ?? ''")  # still where it was


def test_keys_turn_pages_by_the_books_direction_and_not_while_typing(page, book_id):
    open_book(page, book_id)
    page.evaluate("""() => {
        const v = document.querySelector('foliate-view');
        v.book.dir = 'rtl';  // as in an Arabic or Hebrew book
        window.turns = [];
        v.next = async () => { window.turns.push('next'); };
        v.prev = async () => { window.turns.push('prev'); };
    }""")
    page.evaluate("document.activeElement?.blur()")  # the keys go to the app, not a button
    for key in ("PageDown", "Space", "PageUp", "Shift+Space", "ArrowLeft", "ArrowRight"):
        page.keyboard.press(key)
    # RTL: the left arrow goes on, the right one back; PageDown and Space always go on
    assert page.evaluate("window.turns") == ["next", "next", "prev", "prev", "next", "prev"]
    page.evaluate("""() => { window.turns = []; const i = document.createElement('input');
                             document.body.append(i); i.focus(); }""")
    for key in ("Space", "ArrowLeft", "PageDown"):
        page.keyboard.press(key)
    assert page.evaluate("window.turns") == []


def test_the_contents_show_headings_and_entries_without_text(page, book_id):
    open_book(page, book_id)
    page.get_by_label("Contents").click()
    page.get_by_text("Teil I").wait_for()
    assert page.get_by_role("button", name="Teil I").count() == 0  # a heading, not a link
    page.get_by_role("button", name="Kapitel 2").click()
    until(lambda: page.get_by_text("Kapitel 2").count() > 0, timeout=15, what="chapter 2")


def test_a_deleted_highlight_goes_from_the_page(page, book_id):
    """Highlights load before the book has opened: deleting one must still take it off the page."""
    frame = open_book(page, book_id)
    select_first_paragraph(frame)
    page.get_by_label("Highlight").click()
    page.wait_for_timeout(500)
    page.reload()
    open_book(page, book_id)
    page.evaluate("""() => {  // foliate draws in a closed shadow root: watch what it's asked to take off
        const v = document.querySelector('foliate-view');
        const remove = v.deleteAnnotation.bind(v);
        window.removed = [];
        v.deleteAnnotation = (a) => { window.removed.push(a.value); return remove(a); };
    }""")
    page.get_by_label("Contents").click()
    page.get_by_role("tab", name=re.compile(r"Notes")).click()
    n = page.get_by_label("Delete").count()
    assert n
    for _ in range(n):
        page.get_by_label("Delete").first.click()
        page.wait_for_timeout(300)
    # (the list also holds the bookmark of another test: not on the page)
    until(lambda: len(page.evaluate("window.removed")) > 0, what="the highlights taken off the page")
    assert all(cfi.startswith("epubcfi(") for cfi in page.evaluate("window.removed"))


def test_looked_up_words_are_underlined_without_changing_the_page(page, book_id):
    """EPUB positions (highlights, the reading place) count the page's nodes: the underlines mustn't add any."""
    page.route("**/api/looked-up-words**", lambda route: route.fulfill(json=["sonne"]))
    frame = open_book(page, book_id)
    seen = "() => [CSS.highlights.get('seen')?.size ?? 0, document.querySelectorAll('.seen').length]"
    until(lambda: frame.evaluate(seen)[0] > 0, what="the underlined words")
    assert frame.evaluate(seen)[1] == 0
    # the setting off: the underlines go from the open page too
    page.get_by_label("Text settings").click()
    page.get_by_label("Underline words I looked up").click()
    until(lambda: frame.evaluate(seen)[0] == 0, what="the underlines gone")
