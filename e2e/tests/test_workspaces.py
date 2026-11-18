import hashlib
import io
import zipfile

import httpx
import pytest
from helpers import TITLE, WEB, open_book, select_first_paragraph, until


@pytest.fixture(scope="module")
def second_book(api):
    """A small reflow book, the second tab"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("book.json", '{"format": 1, "title": "Notizen", "author": "Test", "language": "de", '
                                '"chapters": [{"file": "index.html", "title": "Eins", "part": ""}]}')
        z.writestr("index.html", "<h1>Eins</h1><p>Zweites Buch.</p>")
    data = out.getvalue()
    info = {"reflow": {"size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "content_type": "application/zip"}}
    book = api.post("/api/books", json={"title": "Notizen", "author": "Test", "language": "de", "files": info}).json()
    httpx.put(book["uploads"]["reflow"], content=data, headers={"Content-Type": "application/zip"}).raise_for_status()
    api.post(f"/api/books/{book['id']}/commit").raise_for_status()
    return book["id"]


def tabs(page):
    return page.get_by_role("tablist", name="Open books").get_by_role("tab")


def test_two_books_as_tabs_stay_open_and_come_back_after_a_reload(page, book_id, second_book):
    frame = open_book(page, book_id)
    page.evaluate("() => { document.querySelector('foliate-view').dataset.kept = 'yes'; }")
    page.goto(f"{WEB}/#/read/{second_book}")
    page.locator(".reflow").get_by_text("Zweites Buch.").wait_for(timeout=30_000)
    until(lambda: tabs(page).count() == 2, what="two tabs")

    tabs(page).filter(has_text=TITLE).click()
    assert page.url.endswith(f"/read/{book_id}")
    # the first book wasn't opened again: still the same view, at its place
    assert page.evaluate("() => document.querySelector('foliate-view').dataset.kept") == "yes"
    # a selection in it opens its panel only (the other book, hidden, doesn't take it)
    select_first_paragraph(frame)
    page.get_by_label("Highlight").wait_for()
    assert page.get_by_label("Copy").count() == 1

    page.reload()
    open_book(page, book_id)
    until(lambda: tabs(page).count() == 2, what="the same two tabs after a reload")
    # Back leaves the reader instead of going through the tabs
    tabs(page).filter(has_text="Notizen").click()
    page.locator(".reflow").get_by_text("Zweites Buch.").wait_for()


def test_named_workspaces_follow_the_account_and_the_app_opens_where_it_was_left(page, book_id, second_book, api,
                                                                                 signed_in):
    open_book(page, book_id)
    page.goto(f"{WEB}/#/read/{second_book}")
    until(lambda: tabs(page).count() == 2, what="two tabs")
    page.get_by_role("button", name="Workspace: Reading").click()
    page.get_by_role("menuitem", name="New workspace…").click()
    page.get_by_label("Name").fill("Thesis")
    page.get_by_role("button", name="Create").click()
    page.get_by_role("button", name="Workspace: Thesis").wait_for()
    assert tabs(page).count() == 1  # it starts with the book being read
    until(lambda: sorted(w["name"] for w in api.get("/api/workspaces").json()) == ["Reading", "Thesis"],
          what="both workspaces on the server")

    # back to the first: its tab in front on this device
    page.get_by_role("button", name="Workspace: Thesis").click()
    page.get_by_role("menuitem", name="Reading").click()
    page.get_by_role("button", name="Workspace: Reading").wait_for()
    assert tabs(page).count() == 2

    # the app started again (same device) while in a book: it opens in that book
    again = page.context.new_page()
    again.goto(WEB)
    again.wait_for_url("**/#/read/**", timeout=15_000)

    # another device (signed in, nothing else on it): the same workspaces
    other = page.context.browser.new_context(storage_state=signed_in)
    try:
        p = other.new_page()
        p.goto(f"{WEB}/#/read/{book_id}")
        p.get_by_role("button", name="Workspace: Reading").wait_for(timeout=30_000)
        p.get_by_role("button", name="Workspace: Reading").click()
        p.get_by_role("menuitem", name="Thesis").wait_for()
    finally:
        other.close()


def test_on_a_wide_screen_held_sideways_the_tabs_are_a_column_on_the_left(page, book_id, second_book):
    open_book(page, book_id)
    page.evaluate("() => { document.querySelector('foliate-view').dataset.kept = 'yes'; }")
    page.goto(f"{WEB}/#/read/{second_book}")
    until(lambda: tabs(page).count() == 2, what="two tabs")
    tabs(page).filter(has_text=TITLE).click()
    page.set_viewport_size({"width": 1280, "height": 720})  # a laptop
    tablist = page.get_by_role("tablist", name="Open books")
    until(lambda: tablist.get_attribute("aria-orientation") == "vertical", what="the tabs as a column")
    bar = page.locator("header:visible").bounding_box()
    box = tablist.bounding_box()
    book = page.locator("foliate-view:visible").bounding_box()
    assert box["y"] >= bar["y"] + bar["height"] - 1  # under the bar, not in it
    assert box["x"] + box["width"] <= book["x"] + 1  # left of the book
    page.set_viewport_size({"width": 420, "height": 860})  # a phone upright: a row under the bar again
    until(lambda: tablist.get_attribute("aria-orientation") == "horizontal", what="the tabs as a row")
    # turning the screen didn't open the book again
    assert page.evaluate("() => document.querySelector('foliate-view').dataset.kept") == "yes"
