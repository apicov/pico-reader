
from tests.helpers import BODY, ask, call, new, say


def test_translation_tokens_are_recorded_per_reader(client, auth_headers, admin_headers, groq):
    client.post("/api/translate", headers=auth_headers, json=BODY)
    client.post("/api/translate", headers=auth_headers, json=BODY)  # from the store: no tokens
    u = client.get("/api/usage", headers=auth_headers, params={"period": "month"}).json()
    assert u["calls"] == 1 and u["prompt_tokens"] == 120 and u["completion_tokens"] == 30
    assert u["by_purpose"][0]["purpose"] == "translate"
    assert client.get("/api/usage", headers=admin_headers).json()["calls"] == 0  # someone else's


def test_chat_tokens_by_purpose(client, admin_headers, indexed_book, agent_ai):
    agent_ai.steps += [call("reading_goal", {}), say("Your goal is off.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "What is my goal?")
    purposes = {p["purpose"]: p for p in client.get("/api/usage", headers=admin_headers).json()["by_purpose"]}
    assert purposes["chat"]["calls"] == 2 and purposes["chat"]["prompt_tokens"] == 1800
    assert purposes["chat_title"]["calls"] == 1


def test_the_agent_can_report_usage(client, admin_headers, indexed_book, agent_ai):
    import json
    agent_ai.steps += [call("ai_usage", {"period": "month"}), say("You used 950 tokens.")]
    cid = new(client, admin_headers)
    ask(client, admin_headers, cid, "How many tokens did I use?")
    result = json.loads(agent_ai.agent_calls[1]["messages"][-1]["content"])
    assert result["calls"] >= 1 and "by_purpose" in result
