from tests.test_chat import FakeGroq, call, new, ask, say  # noqa: F401
from tests.test_chat import groq as chat_groq  # noqa: F401 (fixture)
from tests.test_search import fake_embed, fresh_query_cache, indexed_book  # noqa: F401 (fixtures)
from tests.test_translate import BODY, groq  # noqa: F401 (fixture)


def test_translation_tokens_are_recorded_per_reader(client, auth_headers, admin_headers, groq):
    client.post("/api/translate", headers=auth_headers, json=BODY)
    client.post("/api/translate", headers=auth_headers, json=BODY)  # from the store: no tokens
    u = client.get("/api/usage", headers=auth_headers, params={"period": "month"}).json()
    assert u["calls"] == 1 and u["prompt_tokens"] == 120 and u["completion_tokens"] == 30
    assert u["by_purpose"][0]["purpose"] == "translate"
    assert client.get("/api/usage", headers=admin_headers).json()["calls"] == 0  # someone else's


def test_chat_tokens_by_purpose(client, admin_headers, indexed_book, chat_groq):
    chat_groq.steps += [call("reading_goal", {}), say("Your goal is off.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "What is my goal?")
    purposes = {p["purpose"]: p for p in client.get("/api/usage", headers=admin_headers).json()["by_purpose"]}
    assert purposes["chat"]["calls"] == 2 and purposes["chat"]["prompt_tokens"] == 1800
    assert purposes["chat_title"]["calls"] == 1


def test_the_agent_can_report_usage(client, admin_headers, indexed_book, chat_groq):
    import json
    chat_groq.steps += [call("ai_usage", {"period": "month"}), say("You used 950 tokens.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "How many tokens did I use?")
    result = json.loads(chat_groq.agent_calls[1]["messages"][-1]["content"])
    assert result["calls"] >= 1 and "by_purpose" in result
