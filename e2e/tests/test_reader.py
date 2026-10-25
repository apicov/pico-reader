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
