import re

from conftest import TITLE, WEB, until


def test_signed_in_the_library_shows_the_book(page):
    page.goto(WEB)
    page.get_by_text(TITLE).first.wait_for()
    assert page.get_by_role("tab", name=re.compile("All books")).is_visible()


def test_my_shelf_add_survives_a_reload_and_remove(page, api, book_id):
    page.goto(WEB)
    page.get_by_role("tab", name=re.compile("All books")).click()
    page.get_by_label(f"{TITLE}: shelf").click()
    page.get_by_role("menuitem", name="Add to My shelf").click()
    page.get_by_role("tab", name="My shelf (1)").wait_for()
    until(lambda: [e["book_id"] for e in api.get("/api/shelf/mine").json()] == [book_id], what="My shelf on the server")
    page.reload()
    page.get_by_role("tab", name="My shelf (1)").click()
    page.get_by_text(TITLE).first.wait_for()
    page.get_by_label(f"{TITLE}: shelf").click()
    page.get_by_role("menuitem", name="Remove from My shelf").click()
    page.get_by_role("tab", name="My shelf").wait_for()
    until(lambda: api.get("/api/shelf/mine").json() == [], what="My shelf emptied on the server")
