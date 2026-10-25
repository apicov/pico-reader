"""Every agent tool against real data. `agent_tools.run` turns any failure into {"error": …} for the model, so a
broken query would only show as a vague answer in the chat: these tests check that no tool returns an error."""

from contextlib import contextmanager

import pytest
from sqlalchemy.orm import sessionmaker

from app import agent_tools
from app.auth import find_reader
from app.db import get_engine
from tests.test_annotations import HL
from tests.test_learning import CARD
from tests.test_stats import TZ, lookup, make_book, session
from tests.test_translate import BODY, groq  # noqa: F401 (fixture)

ME = "boss@example.com"


@contextmanager
def context():
    with sessionmaker(bind=get_engine())() as db:
        yield agent_tools.Context(db=db, reader=find_reader(db, ME), tz=TZ, sources=[])


def ok(ctx, name, **args):
    result = agent_tools.run(ctx, name, args)
    assert "error" not in result, f"{name}({args}) → {result}"
    return result


@pytest.fixture
def wolke(client, admin_headers, bucket, groq):
    """A German book I've read, looked words up in, highlighted, translated from and made a card for."""
    b = make_book(client, admin_headers)
    client.post("/api/events", headers=admin_headers, json={
        "sessions": [session(1, b, 0, 600, 0.10, 0.20), session(2, b, 1, 1200, 0.20, 0.40)],
        "lookups": [lookup(1, b, "Mühe"), lookup(2, b, "Mühe", 1), lookup(3, b, "Mühe", 2),
                    lookup(4, b, "Xyzzy", found=False)]})
    client.put("/api/annotations/aaaaaaaa-1", headers=admin_headers, json={**HL, "book_id": b})
    client.put("/api/review-cards/card-00000001", headers=admin_headers, json=CARD)
    assert client.post("/api/translate", headers=admin_headers, json={**BODY, "book_id": b}).status_code == 200
    return b


def test_every_read_tool_runs_without_arguments(wolke):
    with context() as ctx:
        for name, tool in agent_tools.TOOLS.items():
            if not tool.changes and not tool.parameters["required"]:
                ok(ctx, name)


def test_the_read_tools_report_my_reading(wolke):
    with context() as ctx:
        assert [b["title"] for b in ok(ctx, "list_books")["books"]] == ["Die Wolke"]
        details = ok(ctx, "book_details", book=wolke)  # by id
        assert details["minutes_read"] == 30 and details["minutes_left"] == 100 and details["highlights"] == 1
        stats = ok(ctx, "reading_stats", period="week", book="wolke")  # by (part of) the title
        assert stats["minutes"] == 30 and stats["streak_days"]["current"] == 2 and stats["books"][0]["title"] == "Die Wolke"
        looked_up = ok(ctx, "lookup_stats", period="month", language="de")
        assert {"word": "mühe", "times": 3} in looked_up["words_looked_up_repeatedly"]
        assert [w["word"] for w in looked_up["not_found_in_dictionaries"]] == ["Xyzzy"]
        assert ok(ctx, "lookup_stats", language="fr")["by_language"] == {}
        [t] = ok(ctx, "translations", query="Janna", book="Wolke")["translations"]
        assert t["book"] == "Die Wolke" and t["translation"].startswith("Janna-Berta vio")
        assert ok(ctx, "translations", query="nirgends")["translations"] == []
        [h] = ok(ctx, "highlights", book="wolke")["items"]
        assert (h["kind"], h["text"], h["at_percent"]) == ("highlight", "Sie hatten Mühe", 12)
        due = ok(ctx, "vocabulary_due", language="de")
        assert due["cards"] == 1 and due["due_terms"] == ["die Mühe"]
        assert ok(ctx, "reading_goal")["enabled"] is False
        assert ok(ctx, "ai_usage", period="month")["calls"] == 1  # the translation
        assert ok(ctx, "ai_usage", period="decade")["calls"] == 1  # an unknown period: the month
        assert wolke in ok(ctx, "export_anki", book="wolke")["link"]["path"]
        link = ok(ctx, "open_book_at", book="Wolke", percent=150)["link"]
        assert link["book_id"] == wolke and link["progress"] == 1.0


def test_every_tool_that_takes_a_book_says_when_none_matches(wolke):
    with context() as ctx:
        for name, tool in agent_tools.TOOLS.items():
            if "book" in tool.parameters["properties"] and not tool.changes:
                args = {"book": "Kafka", "query": "x", "note": "x"}
                args = {k: v for k, v in args.items() if k in tool.parameters["properties"]}
                assert "No book matches 'Kafka'" in agent_tools.run(ctx, name, args).get("error", ""), name
        assert "No reader called" in agent_tools.run(ctx, "member_lists", {"handle": "@niemand"})["error"]


def test_the_changing_tools_do_what_they_say(wolke, client, admin_headers):
    with context() as ctx:
        added = ok(ctx, "add_review_cards", language="de", words=["Haus", " "], repeated=True)
        assert added == {"added": 2, "skipped_existing": 0}  # Haus, and Mühe (looked up 3 times; Xyzzy only once)
        assert ok(ctx, "add_review_cards", language="de", words=["haus"]) == {"added": 0, "skipped_existing": 1}
        assert ok(ctx, "mark_known", words=["Haus"], language="de") == {"marked_known": 1}
        goal = ok(ctx, "set_reading_goal", enabled=True, minutes=9999, days=[0, 9, 2, 2])["reading_goal"]
        assert goal["enabled"] is True and goal["minutes"] == 600 and goal["days"] == [0, 2]
    cards = client.get("/api/review-cards", headers=admin_headers).json()["cards"]
    live = sorted(c["term"] for c in cards if not c["deleted"])
    assert live == ["die Mühe", "mühe"]  # Haus is known now (the repeated word comes lower-case)
    assert [w["word"] for w in client.get("/api/known-words", headers=admin_headers).json()] == ["haus"]
    assert client.get("/api/settings", headers=admin_headers).json()["reading_goal"]["minutes"] == 600


def test_bad_calls_and_failures_go_back_to_the_model(wolke, monkeypatch):
    with context() as ctx:
        assert agent_tools.run(ctx, "fly_to_the_moon", {}) == {"error": "No tool 'fly_to_the_moon'"}
        assert agent_tools.run(ctx, "reading_stats", "{not json") == {"error": "Arguments must be JSON"}
        assert agent_tools.run(ctx, "reading_stats", {"colour": "red"})["error"].startswith("Bad arguments")

        def broken(ctx, **_):
            ctx.db.execute(agent_tools.text("SELECT * FROM no_such_table"))
        monkeypatch.setattr(agent_tools.TOOLS["reading_goal"], "run", broken)
        assert "no_such_table" in agent_tools.run(ctx, "reading_goal", {})["error"]
        assert ok(ctx, "list_books")["books"]  # rolled back: the session still works
