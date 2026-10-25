"""The browser, a signed-in state shared by every test (sign-in codes are limited to 3 an hour per email), and
an API client with the same reader's token for checking what reached the server."""

import os
import re
import time
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Browser, Page, sync_playwright

WEB = os.environ["E2E_WEB"]
API = os.environ["E2E_API"]
AI = os.environ["E2E_AI"]
API_LOG = Path(os.environ["E2E_API_LOG"])
EMAIL = "reader@example.com"
TITLE = "Die Wolke (Probe)"


def latest_code() -> str:
    for _ in range(40):
        codes = re.findall(r"VERIFICATION CODE: (\d{6})", API_LOG.read_text())
        if codes:
            return codes[-1]
        time.sleep(0.25)
    raise AssertionError("No sign-in code in the API log")


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("E2E_CHROMIUM", "/usr/bin/chromium-browser"))
        yield b
        b.close()


@pytest.fixture(scope="session")
def signed_in(browser: Browser, tmp_path_factory) -> dict:
    """Signs in through the login page once; returns the browser state (local storage holds the token)."""
    context = browser.new_context()
    page = context.new_page()
    page.goto(WEB)
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_role("button", name=re.compile("code", re.I)).click()
    page.get_by_label("Code").fill(latest_code())
    page.get_by_role("button", name="Sign in").click()
    page.get_by_text(TITLE).first.wait_for()
    state = context.storage_state()
    context.close()
    return state


@pytest.fixture
def page(browser: Browser, signed_in: dict) -> Page:
    context = browser.new_context(storage_state=signed_in, viewport={"width": 420, "height": 860})
    page = context.new_page()
    yield page
    context.close()


@pytest.fixture(scope="session")
def api(signed_in: dict) -> httpx.Client:
    token = next(i["value"] for o in signed_in["origins"] for i in o["localStorage"]
                 if i["name"] == "CapacitorStorage.reader_token")
    with httpx.Client(base_url=API, headers={"Authorization": f"Bearer {token}"}) as client:
        yield client


@pytest.fixture(scope="session")
def book_id(api: httpx.Client) -> str:
    return next(b["id"] for b in api.get("/api/library").json()["books"] if b["title"] == TITLE)


def script_ai(*messages: dict) -> None:
    """The fake AI's next agent replies, in order."""
    httpx.post(f"{AI}/script", json=list(messages)).raise_for_status()


def until(check, timeout=10.0, what="the condition"):
    """Polls `check()` until it's truthy (sync to the server happens in the background)."""
    end = time.time() + timeout
    while time.time() < end:
        if (result := check()):
            return result
        time.sleep(0.25)
    raise AssertionError(f"Timed out waiting for {what}")
