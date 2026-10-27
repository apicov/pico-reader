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


def test_a_collection_groups_my_shelf_and_survives_a_reload(page, api, book_id):
    page.goto(WEB)
    page.get_by_role("tab", name=re.compile("All books")).click()
    page.get_by_label(f"{TITLE}: shelf").click()
    page.get_by_role("menuitem", name="Collections…").click()
    page.get_by_placeholder("New collection").fill("Krimis")
    page.get_by_role("button", name="Add", exact=True).click()
    page.get_by_role("checkbox").first.wait_for()
    assert page.get_by_role("checkbox").first.is_checked()  # the new collection has the book
    page.get_by_role("button", name="Done").click()
    page.get_by_role("tab", name=re.compile("My shelf")).click()
    # as folders (the default): the book is inside "Krimis", not loose on the shelf
    page.get_by_role("button", name="Open Krimis").wait_for()
    assert page.get_by_label(f"{TITLE}: shelf").count() == 0
    page.get_by_role("button", name="Open Krimis").click()
    page.get_by_text(TITLE).first.wait_for()
    cols = until(lambda: [c for c in api.get("/api/shelf/collections").json() if c["book_ids"] == [book_id]],
                 what="the collection on the server")
    assert cols[0]["name"] == "Krimis"
    page.reload()  # the open folder is in the address
    page.get_by_label("Back to My shelf").wait_for()
    page.get_by_text(TITLE).first.wait_for()
    page.go_back()
    page.get_by_role("button", name="Open Krimis").wait_for()
    # all books flat: the chips filter again
    page.get_by_role("button", name="All books flat").click()
    page.get_by_role("button", name="Krimis (1)").click()
    page.get_by_text(TITLE).first.wait_for()
    # clean up for the other journeys: deleting the collection keeps the book on My shelf
    page.get_by_role("button", name="Collections…").click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_label("Delete Krimis").click()
    until(lambda: api.get("/api/shelf/collections").json() == [], what="the collection deleted")
    assert [e["book_id"] for e in api.get("/api/shelf/mine").json()] == [book_id]
    page.get_by_role("button", name="Done").click()
    page.get_by_label(f"{TITLE}: shelf").click()
    page.get_by_role("menuitem", name="Remove from My shelf").click()
    until(lambda: api.get("/api/shelf/mine").json() == [], what="My shelf emptied")
