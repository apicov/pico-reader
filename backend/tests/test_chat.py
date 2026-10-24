import json
from contextlib import contextmanager

import pytest

from app import groq_client
from app.config import get_settings
from tests.test_search import fake_embed, fresh_query_cache, indexed_book  # noqa: F401 (fixtures)


class FakeGroq:
    """JSON calls (the search plan) answer from `plans`; streamed calls replay `answers` in pieces."""

    def __init__(self):
        self.plans, self.answers, self.json_calls, self.stream_calls = [], [], [], []
        self.fail_stream = False

    def post(self, url, json=None, headers=None, timeout=None):
        import httpx
        self.json_calls.append(json)
        plan = self.plans.pop(0) if self.plans else {"question": json["messages"][1]["content"].split("NEW MESSAGE: ")[-1],
                                                     "translations": {}, "title": "Pruning chat"}
        return httpx.Response(200, json={"choices": [{"message": {"content": __import__("json").dumps(plan)}}]})

    @contextmanager
    def stream(self, method, url, json=None, headers=None, timeout=None):
        self.stream_calls.append(json)
        answer = self.answers.pop(0) if self.answers else "Pruning removes **small** weights [1]."
        fail = self.fail_stream

        class Res:
            status_code = 500 if fail else 200
            text = '{"error": {"message": "overloaded"}}'

            def read(self):
                return b""

            def json(self):
                return __import__("json").loads(self.text)

            def iter_lines(self):
                for i in range(0, len(answer), 8):
                    yield "data: " + __import__("json").dumps({"choices": [{"delta": {"content": answer[i:i + 8]}}]})
                yield "data: [DONE]"

        yield Res()


@pytest.fixture
def groq(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    fake = FakeGroq()
    monkeypatch.setattr(groq_client.httpx, "post", fake.post)
    monkeypatch.setattr(groq_client.httpx, "stream", fake.stream)
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


def test_a_turn_streams_sources_then_text_and_is_stored(client, admin_headers, indexed_book, groq):
    cid = new(client, admin_headers)
    r = client.post(f"/api/conversations/{cid}/messages", headers=admin_headers, json={"content": "What does pruning remove?"})
    assert r.headers["content-type"].startswith("text/event-stream")
    evs = events(r)
    assert evs[0][0] == "sources" and evs[0][1][0]["heading"] == "1 Pruning"
    assert "".join(d for n, d in evs if n == "delta") == "Pruning removes **small** weights [1]."
    assert evs[-1][0] == "done" and evs[-1][1]["title"] == "Pruning chat"
    stored = client.get(f"/api/conversations/{cid}", headers=admin_headers).json()
    assert [m["role"] for m in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][1]["sources"][0]["heading"] == "1 Pruning"
    assert stored["conversation"]["title"] == "Pruning chat"


def test_a_follow_up_sees_the_conversation(client, admin_headers, indexed_book, groq):
    cid = new(client, admin_headers)
    client.post(f"/api/conversations/{cid}/messages", headers=admin_headers, json={"content": "What does pruning remove?"})
    groq.plans.append({"question": "How does pruning differ from quantization?", "translations": {"en": "pruning vs quantization"}})
    client.post(f"/api/conversations/{cid}/messages", headers=admin_headers, json={"content": "And how is it different from quantization?"})
    plan_input = groq.json_calls[-1]["messages"][1]["content"]
    assert "USER: What does pruning remove?" in plan_input and "ASSISTANT: Pruning removes" in plan_input
    answer_messages = groq.stream_calls[-1]["messages"]
    assert [m["role"] for m in answer_messages] == ["system", "user", "assistant", "user"]
    assert "The reader's library has 1 book" in answer_messages[0]["content"]
    assert "Efficient ML" in answer_messages[0]["content"]


def test_naming_a_book_searches_only_it(client, admin_headers, indexed_book, groq, monkeypatch):
    from app.routes import chat
    seen = {}
    real = chat.retrieve
    monkeypatch.setattr(chat, "retrieve", lambda db, q, scope, n, variants=None: seen.setdefault("scope", scope) and real(db, q, scope, n, variants))
    cid = new(client, admin_headers)
    client.post(f"/api/conversations/{cid}/messages", headers=admin_headers, json={"content": "What is pruning in efficient ml?"})
    assert seen["scope"] == [indexed_book]


def test_groq_failing_ends_with_an_error_and_keeps_the_question(client, admin_headers, indexed_book, groq):
    groq.fail_stream = True
    cid = new(client, admin_headers)
    evs = events(client.post(f"/api/conversations/{cid}/messages", headers=admin_headers, json={"content": "Pruning?"}))
    assert evs[-1][0] == "error" and "overloaded" in evs[-1][1]["message"]
    assert [m["role"] for m in client.get(f"/api/conversations/{cid}", headers=admin_headers).json()["messages"]] == ["user"]


def test_list_search_rename_delete(client, admin_headers, indexed_book, groq):
    a = new(client, admin_headers, "conv-aaaaaaaa")
    b = new(client, admin_headers, "conv-bbbbbbbb", title="Kafka notes")
    client.post(f"/api/conversations/{a}/messages", headers=admin_headers, json={"content": "What does quantization store?"})
    listed = client.get("/api/conversations", headers=admin_headers).json()
    assert [c["id"] for c in listed] == [a, b]  # newest activity first
    assert listed[0]["snippet"].startswith("Pruning removes")
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers, params={"q": "quantization"}).json()] == [a]
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers, params={"q": "kafka"}).json()] == [b]
    assert client.patch(f"/api/conversations/{b}", headers=admin_headers, json={"title": "Prozess"}).json()["title"] == "Prozess"
    scoped = client.patch(f"/api/conversations/{b}", headers=admin_headers, json={"book_ids": [indexed_book]}).json()
    assert scoped["book_ids"] == [indexed_book]
    assert client.patch(f"/api/conversations/{b}", headers=admin_headers, json={"all_books": True}).json()["book_ids"] is None
    assert client.delete(f"/api/conversations/{a}", headers=admin_headers).status_code == 204
    assert [c["id"] for c in client.get("/api/conversations", headers=admin_headers).json()] == [b]


def test_conversations_are_private(client, admin_headers, auth_headers, indexed_book, groq):
    cid = new(client, admin_headers)
    assert client.get("/api/conversations", headers=auth_headers).json() == []
    assert client.get(f"/api/conversations/{cid}", headers=auth_headers).status_code == 404
    assert client.post(f"/api/conversations/{cid}/messages", headers=auth_headers, json={"content": "hi"}).status_code == 404
    assert client.post("/api/conversations", headers=auth_headers, json={"id": cid}).status_code == 409


def test_ask_knows_the_library(client, admin_headers, indexed_book, monkeypatch):
    from app.routes import search
    seen = {}
    monkeypatch.setattr(search, "_translated", lambda q, langs: ())
    monkeypatch.setattr(search.groq_client, "chat_json", lambda system, user, max_tokens: (
        seen.setdefault("user", user), {"answer": "You have one book."})[1:] + ("m",))
    r = client.post("/api/ask", headers=admin_headers, json={"question": "How many books do I have?"})
    assert r.json()["answer"] == "You have one book."
    assert "The reader's library has 1 book" in seen["user"] and "Efficient ML" in seen["user"]
