import json

import pytest

from app import groq_client
from app.config import get_settings
from tests.test_search import fake_embed, fresh_query_cache, indexed_book  # noqa: F401 (fixtures)


def call(name, args, cid="call_1"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def say(text_):
    return {"role": "assistant", "content": text_}


class FakeGroq:
    """Agent steps (requests with tools) come from `steps`; other JSON calls (titles, query translation)
    answer from `json_replies` or a default."""

    def __init__(self):
        self.steps, self.json_replies, self.agent_calls, self.json_calls = [], [], [], []

    def post(self, url, json=None, headers=None, timeout=None):
        import httpx
        if "tools" in json:
            self.agent_calls.append(json)
            step = self.steps.pop(0) if self.steps else say("Pruning removes **small** weights [1].")
            if isinstance(step, httpx.Response):
                return step
            return httpx.Response(200, json={"choices": [{"message": step}]})
        self.json_calls.append(json)
        reply = self.json_replies.pop(0) if self.json_replies else {"title": "Pruning chat", "translations": {}}
        return httpx.Response(200, json={"choices": [{"message": {"content": __import__("json").dumps(reply)}}]})


@pytest.fixture
def groq(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    fake = FakeGroq()
    monkeypatch.setattr(groq_client.httpx, "post", fake.post)
    yield fake
    get_settings.cache_clear()


def events(response) -> list[tuple[str, object]]:
    out = []
    for block in response.text.strip().split("\n\n"):
        name = block.split("\n")[0].removeprefix("event: ")
        out.append((name, json.loads(block.split("\n", 1)[1].removeprefix("data: "))))
    return out


def new(client, headers, cid="conv-00000001", **body):
    r = client.post("/api/conversations", headers=headers, json={"id": cid, **body})
    assert r.status_code == 200, r.text
    return cid


def ask(client, headers, cid, content):
    return events(client.post(f"/api/conversations/{cid}/messages", headers=headers, json={"content": content, "tz": "Europe/Berlin"}))


def test_the_agent_searches_cites_and_stores(client, admin_headers, indexed_book, groq):
    groq.steps += [call("search_passages", {"query": "pruning"}), say("Pruning removes small weights [1].")]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "What does pruning remove?")
    names = [n for n, _ in evs]
    assert names[0] == "tool" and evs[0][1]["label"] == "searched the books"
    sources = next(d for n, d in evs if n == "sources")
    assert sources[0]["heading"] == "1 Pruning"
    assert "".join(d for n, d in evs if n == "delta") == "Pruning removes small weights [1]."
    assert evs[-1][0] == "done" and evs[-1][1]["title"] == "Pruning chat"
    tool_msg = groq.agent_calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and '"source": 1' in tool_msg["content"]
    stored = client.get(f"/api/conversations/{cid}", headers=admin_headers).json()
    assert [m["role"] for m in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][1]["extras"]["tools"] == ["searched the books"]


def test_the_agent_knows_the_library_and_the_conversation(client, admin_headers, indexed_book, groq):
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "What does pruning remove?")
    ask(client, admin_headers, cid, "And quantization?")
    msgs = groq.agent_calls[-1]["messages"]
    assert "The reader's library has 1 book" in msgs[0]["content"] and "Efficient ML" in msgs[0]["content"]
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user"]


def test_statistics_tools(client, admin_headers, indexed_book, groq):
    from tests.test_stats import session
    client.post("/api/events", headers=admin_headers, json={"sessions": [session(1, indexed_book, 0, 900)]})
    groq.steps += [call("reading_stats", {"period": "week"}), say("You read 15 minutes this week.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "How much did I read this week?")
    result = json.loads(groq.agent_calls[1]["messages"][-1]["content"])
    assert result["minutes"] == 15 and result["books"][0]["title"] == "Efficient ML"


def test_a_change_waits_for_confirmation(client, admin_headers, indexed_book, groq):
    groq.steps += [call("set_reading_goal", {"enabled": True, "minutes": 30}), say("I proposed a 30-minute goal.")]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "Set me a goal of 30 minutes a day")
    action = next(d for n, d in evs if n == "action")
    assert action["status"] == "pending" and "30 min" in action["label"]
    assert client.get("/api/settings", headers=admin_headers).json()["reading_goal"]["enabled"] is False  # not yet
    r = client.post(f"/api/conversations/{cid}/actions/{action['id']}", headers=admin_headers, json={"approve": True})
    assert r.status_code == 200 and r.json()["content"].startswith("Done:")
    goal = client.get("/api/settings", headers=admin_headers).json()["reading_goal"]
    assert goal["enabled"] is True and goal["minutes"] == 30
    assert client.post(f"/api/conversations/{cid}/actions/{action['id']}", headers=admin_headers, json={"approve": True}).status_code == 409
    stored = client.get(f"/api/conversations/{cid}", headers=admin_headers).json()["messages"]
    assert stored[1]["extras"]["actions"][0]["status"] == "done"


def test_a_cancelled_change_does_nothing(client, admin_headers, indexed_book, groq):
    groq.steps += [call("mark_known", {"words": ["haus"], "language": "de"}), say("Proposed.")]
    cid = new(client, admin_headers)
    action = next(d for n, d in ask(client, admin_headers, cid, "I know Haus") if n == "action")
    r = client.post(f"/api/conversations/{cid}/actions/{action['id']}", headers=admin_headers, json={"approve": False})
    assert r.json()["content"].startswith("Cancelled")
    assert client.get("/api/known-words", headers=admin_headers).json() == []


def test_links_and_unknown_books(client, admin_headers, indexed_book, groq):
    groq.steps += [call("open_book_at", {"book": "efficient", "percent": 40}), call("book_details", {"book": "Kafka"}, "c2"),
                   say("Here it is.")]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "Open Efficient ML at 40%")
    link = next(d for n, d in evs if n == "link")
    assert link["book_id"] == indexed_book and link["progress"] == 0.4
    assert "No book matches" in groq.agent_calls[2]["messages"][-1]["content"]


def test_rounds_are_capped(client, admin_headers, indexed_book, groq):
    groq.steps += [call("list_books", {}, f"c{i}") for i in range(10)]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "loop")
    assert "too many steps" in "".join(d for n, d in evs if n == "delta")
    assert len(groq.agent_calls) == 5


def test_groq_failing_ends_with_an_error_and_keeps_the_question(client, admin_headers, indexed_book, groq):
    import httpx
    groq.steps.append(httpx.Response(500, json={"error": {"message": "overloaded"}}))
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "Pruning?")
    assert evs[-1][0] == "error" and "overloaded" in evs[-1][1]["message"]
    assert [m["role"] for m in client.get(f"/api/conversations/{cid}", headers=admin_headers).json()["messages"]] == ["user"]


def test_list_search_rename_delete(client, admin_headers, indexed_book, groq):
    a = new(client, admin_headers, "conv-aaaaaaaa")
    b = new(client, admin_headers, "conv-bbbbbbbb", title="Kafka notes")
    groq.steps.append(say("Quantization stores weights as integers."))
    ask(client, admin_headers, a, "What does quantization store?")
    listed = client.get("/api/conversations", headers=admin_headers).json()
    assert [c["id"] for c in listed] == [a, b]
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers, params={"q": "quantization"}).json()] == [a]
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers, params={"q": "kafka"}).json()] == [b]
    assert client.patch(f"/api/conversations/{b}", headers=admin_headers, json={"title": "Prozess"}).json()["title"] == "Prozess"
    assert client.delete(f"/api/conversations/{a}", headers=admin_headers).status_code == 204
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers).json()] == [b]


def test_conversations_are_private(client, admin_headers, auth_headers, indexed_book, groq):
    cid = new(client, admin_headers)
    assert client.get("/api/conversations", headers=auth_headers).json() == []
    assert client.get(f"/api/conversations/{cid}", headers=auth_headers).status_code == 404
    assert client.post(f"/api/conversations/{cid}/messages", headers=auth_headers, json={"content": "hi"}).status_code == 404


def test_ask_knows_the_library(client, admin_headers, indexed_book, monkeypatch):
    from app.routes import search
    seen = {}
    monkeypatch.setattr(search, "_translated", lambda q, langs: ())
    monkeypatch.setattr(search.groq_client, "chat_json", lambda system, user, max_tokens: (
        seen.setdefault("user", user), {"answer": "You have one book."})[1:] + ("m",))
    r = client.post("/api/ask", headers=admin_headers, json={"question": "How many books do I have?"})
    assert r.json()["answer"] == "You have one book."
    assert "The reader's library has 1 book" in seen["user"]


def test_citations_without_passages_are_removed(client, admin_headers, indexed_book, groq):
    groq.steps += [call("reading_stats", {"period": "week"}), say("You read 15 minutes [1]. Keep going [2].")]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "How much did I read?")
    assert "".join(d for n, d in evs if n == "delta") == "You read 15 minutes. Keep going."


def test_the_model_learns_a_proposal_was_not_applied(client, admin_headers, indexed_book, groq):
    groq.steps += [call("set_reading_goal", {"enabled": True, "minutes": 15}), say("I proposed a 15-minute goal.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "Set my goal to 15 minutes")
    ask(client, admin_headers, cid, "What is my goal?")
    history = groq.agent_calls[-1]["messages"]
    assert "NOT applied yet" in history[2]["content"]
