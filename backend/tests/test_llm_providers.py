"""The three AI providers behind groq_client: what goes over the wire, and what comes back in the app's shape."""

import json
from types import SimpleNamespace

import httpx
import pytest

from app import anthropic_llm, groq_client
from app.config import get_settings


@pytest.fixture
def use(monkeypatch):
    def configure(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        get_settings.cache_clear()
    yield configure
    get_settings.cache_clear()


@pytest.fixture
def wire(monkeypatch):
    """httpx.post, recorded; replies queued in `replies` (a dict body, or an httpx.Response)."""
    sent, replies = [], []

    def post(url, json=None, headers=None, timeout=None):
        sent.append({"url": url, "json": dict(json), "headers": headers})
        reply = replies.pop(0) if replies else {"choices": [{"message": {"content": '{"ok": true}'}}], "model": "m",
                                                "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        return reply if isinstance(reply, httpx.Response) else httpx.Response(200, json=reply)
    monkeypatch.setattr(groq_client.httpx, "post", post)
    return sent, replies


def test_groq_stays_the_default(use, wire):
    use(GROQ_API_KEY="gk")
    sent, _ = wire
    assert groq_client.chat_json("system", "user")[0] == {"ok": True}
    assert sent[0]["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert sent[0]["headers"]["Authorization"] == "Bearer gk"
    assert sent[0]["json"]["model"] == groq_client.model() == "qwen/qwen3.8-27b"
    assert sent[0]["json"]["reasoning_format"] == "hidden" and sent[0]["json"]["response_format"] == {"type": "json_object"}


def test_gemini_through_its_openai_compatible_endpoint(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="gem")
    sent, replies = wire
    groq_client.chat_json("system", "user", max_tokens=1000)
    body = sent[0]["json"]
    assert sent[0]["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert sent[0]["headers"]["Authorization"] == "Bearer gem"
    assert body["model"] == "gemini-3.8-flash" and body["reasoning_effort"] == "low"
    assert "reasoning_format" not in body and body["max_tokens"] == 1000 + 2048  # room for its thinking

    # the agent: tool calls come back as they were sent (thought signatures), the app's own keys are left out
    call = {"id": "c1", "type": "function", "function": {"name": "list_books", "arguments": "{}"},
            "extra_content": {"google": {"thought_signature": "sig"}}}
    replies.append({"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [call]}}]})
    message = groq_client.chat_tools([{"role": "user", "content": "hi", "_raw": ["x"]}], [], 500)
    assert message["tool_calls"][0]["extra_content"]["google"]["thought_signature"] == "sig"
    assert sent[1]["json"]["messages"] == [{"role": "user", "content": "hi"}]


def test_a_provider_without_json_mode_is_asked_again_without_it(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="gem")
    sent, replies = wire
    replies.append(httpx.Response(400, json=[{"error": {"message": "Unknown field response_format"}}]))
    replies.append({"choices": [{"message": {"content": 'Here: {"translation": "Hola"}'}}]})
    assert groq_client.chat_json("system", "user")[0] == {"translation": "Hola"}
    assert "response_format" in sent[0]["json"] and "response_format" not in sent[1]["json"]


def test_a_missing_key_names_the_setting(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="")
    with pytest.raises(groq_client.GroqError) as e:
        groq_client.chat_json("system", "user")
    assert e.value.status == 503 and "GEMINI_API_KEY" in str(e.value)


class FakeClaude:
    """anthropic.Anthropic().beta.messages.create, recorded; replies queued as content blocks."""

    def __init__(self):
        self.sent, self.replies = [], []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.sent.append(kwargs)
        blocks, stop = self.replies.pop(0)
        content = [SimpleNamespace(**b, model_dump=lambda b=b, **_: dict(b)) for b in blocks]
        return SimpleNamespace(content=content, stop_reason=stop, model="claude-opus-5-5",
                               usage=SimpleNamespace(input_tokens=100, output_tokens=20))


@pytest.fixture
def claude(use, monkeypatch):
    use(LLM_PROVIDER="anthropic", ANTHROPIC_API_KEY="ak")
    fake = FakeClaude()
    monkeypatch.setattr(anthropic_llm, "_client", lambda key: fake)
    return fake


def test_claude_writes_json_answers(claude):
    claude.replies.append(([{"type": "thinking", "thinking": "", "signature": "s"},
                            {"type": "text", "text": '{"translation": "Hola"}'}], "end_turn"))
    data, model = groq_client.chat_json("You translate.", "Hallo", max_tokens=800)
    assert data == {"translation": "Hola"} and model == "claude-opus-5-5"
    sent = claude.sent[0]
    assert sent["system"] == "You translate." and sent["messages"] == [{"role": "user", "content": "Hallo"}]
    assert sent["max_tokens"] == 800 + anthropic_llm.THINKING_ROOM
    assert sent["fallbacks"] == "default" and sent["betas"] == ["server-side-fallback-2026-07-01"]
    assert "temperature" not in sent and "output_config" not in sent


def test_claude_runs_the_agent_with_its_thinking_passed_back(claude):
    tools = [{"type": "function", "function": {"name": "reading_stats", "description": "Stats",
                                               "parameters": {"type": "object", "properties": {"period": {"type": "string"}}}}}]
    step1 = [{"type": "thinking", "thinking": "", "signature": "sig-1"}, {"type": "text", "text": "Let me look."},
             {"type": "tool_use", "id": "tu_1", "name": "reading_stats", "input": {"period": "week"}},
             {"type": "tool_use", "id": "tu_2", "name": "reading_stats", "input": {"period": "month"}}]
    claude.replies += [(step1, "tool_use"), ([{"type": "text", "text": "You read 40 minutes."}], "end_turn")]
    messages = [{"role": "system", "content": "You are the library."}, {"role": "user", "content": "How much?"}]
    reply = groq_client.chat_tools(messages, tools, 1000)
    assert [c["function"]["name"] for c in reply["tool_calls"]] == ["reading_stats", "reading_stats"]
    assert json.loads(reply["tool_calls"][1]["function"]["arguments"]) == {"period": "month"}
    assert claude.sent[0]["tools"] == [{"name": "reading_stats", "description": "Stats",
                                        "input_schema": tools[0]["function"]["parameters"]}]

    # as chat.py does: the step goes back with its _raw, then each tool's result
    messages.append({"role": "assistant", "content": reply["content"], "tool_calls": reply["tool_calls"], "_raw": reply["_raw"]})
    messages += [{"role": "tool", "tool_call_id": "tu_1", "content": '{"minutes": 40}'},
                 {"role": "tool", "tool_call_id": "tu_2", "content": '{"minutes": 160}'}]
    final = groq_client.chat_tools(messages, tools, 1000)
    assert final["content"] == "You read 40 minutes." and "tool_calls" not in final
    sent = claude.sent[1]
    assert sent["system"] == "You are the library."
    assert sent["messages"][1] == {"role": "assistant", "content": step1}  # unchanged, the thinking included
    assert sent["messages"][2] == {"role": "user", "content": [  # both results in one message
        {"type": "tool_result", "tool_use_id": "tu_1", "content": '{"minutes": 40}'},
        {"type": "tool_result", "tool_use_id": "tu_2", "content": '{"minutes": 160}'}]}


def test_a_claude_refusal_and_effort(claude, use):
    use(ANTHROPIC_EFFORT="low")
    claude.replies.append(([], "refusal"))
    with pytest.raises(groq_client.GroqError) as e:
        groq_client.chat_json("system", "user")
    assert e.value.status == 422 and "declined" in str(e.value)
    assert claude.sent[0]["output_config"] == {"effort": "low"}
