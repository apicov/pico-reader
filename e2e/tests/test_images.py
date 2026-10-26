"""A picture tapped in a book opens full screen: zoom (double tap, the wheel, a pinch), move, and close (✕, Back)."""

import io
import re

from PIL import Image

from conftest import WEB, until
from manual_capture import add_book


def figure() -> bytes:
    image = Image.new("RGB", (600, 400), (40, 90, 160))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def scale(page) -> float:
    page.wait_for_timeout(250)  # the zoom eases in
    transform = page.locator('[data-testid="image-viewer"] img').evaluate("img => getComputedStyle(img).transform")
    return 1.0 if transform == "none" else round(float(re.match(r"matrix\(([-\d.e]+)", transform).group(1)), 2)


def pointer(page, kind: str, pid: int, x: float, y: float) -> None:
    page.locator('[data-testid="image-viewer"]').dispatch_event(
        kind, {"pointerId": pid, "clientX": x, "clientY": y, "isPrimary": pid == 1, "pointerType": "touch", "bubbles": True})


def test_a_picture_opens_large_zooms_and_closes(page, api):
    body = '<p>Look at the figure:</p><p><img src="figure.png" alt="Figure 1: the orbit"/></p>' + "<p>After the figure.</p>" * 3
    book = add_book(api, "Pictures (Probe)", "Test", "en", (90, 90, 90), [("Chapter 1", body)], {"figure.png": figure()})
    page.goto(f"{WEB}/#/read/{book}")
    frame = until(lambda: next((f for f in page.frames if f.locator("img").count()), None), timeout=30, what="the picture")
    frame.locator("img").click()
    viewer = page.locator('[data-testid="image-viewer"]')
    viewer.wait_for()
    assert viewer.locator("img").get_attribute("alt") == "Figure 1: the orbit"
    assert scale(page) == 1

    box = viewer.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    viewer.dblclick(position={"x": box["width"] / 2 + 40, "y": box["height"] / 2})  # double tap: zoom in there
    until(lambda: scale(page) == 2.5, what="the double tap zooming in")
    for pid in (1, 1):  # a double tap with touch pointers too
        pointer(page, "pointerdown", pid, cx, cy)
        pointer(page, "pointerup", pid, cx, cy)
    until(lambda: scale(page) == 1, what="the second double tap zooming back out")

    page.mouse.move(cx, cy)
    page.mouse.wheel(0, -400)  # the wheel zooms in
    until(lambda: scale(page) > 1.5, what="the wheel zoom")
    page.mouse.wheel(0, 2000)
    until(lambda: scale(page) == 1, what="zoomed back out")

    pointer(page, "pointerdown", 1, cx - 30, cy)  # a pinch: two fingers moving apart
    pointer(page, "pointerdown", 2, cx + 30, cy)
    pointer(page, "pointermove", 1, cx - 120, cy)
    pointer(page, "pointermove", 2, cx + 120, cy)
    assert 3.5 < scale(page) < 4.5
    pointer(page, "pointerup", 1, cx - 120, cy)
    pointer(page, "pointerup", 2, cx + 120, cy)

    page.get_by_role("button", name="Close").click()
    viewer.wait_for(state="hidden")
    assert "/read/" in page.url  # still in the book

    frame.locator("img").click()
    viewer.wait_for()
    page.go_back()  # Android's back button does this: closes the picture, not the book
    viewer.wait_for(state="hidden")
    assert "/read/" in page.url
