"""The three AI providers behind groq_client: what goes over the wire, and what comes back in the app's shape."""

import json
from types import SimpleNamespace

import httpx
import pytest

from app import anthropic_llm, groq_client
from app.config import get_settings


@pytest.fixture(autouse=True)
def rested():
    groq_client._resting.clear()
    yield
    groq_client._resting.clear()


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
    assert body["model"] == "gemini-3.5-flash" and body["reasoning_effort"] == "low"
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
    monkeypatch.setattr(anthropic_llm, "_client", lambda key, timeout: fake)
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


# --- a fallback for when the first is unavailable ---

def ok(content='{"ok": true}', model="m"):
    return {"choices": [{"message": {"content": content}}], "model": model, "usage": {"prompt_tokens": 1, "completion_tokens": 1}}


def test_a_limit_moves_the_call_to_the_fallback_and_the_first_rests(use, wire, monkeypatch):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="gemini", LLM_FALLBACK_API_KEY="second")
    sent, replies = wire
    clock = [1000.0]
    monkeypatch.setattr(groq_client.time, "monotonic", lambda: clock[0])
    replies += [httpx.Response(429, json={"error": {"message": "quota"}}, headers={"retry-after": "120"}), ok(), ok()]
    assert groq_client.chat_json("s", "u")[0] == {"ok": True}
    assert [r["headers"]["Authorization"] for r in sent] == ["Bearer first", "Bearer second"]
    groq_client.chat_json("s", "u")  # the first is resting: straight to the second
    assert sent[-1]["headers"]["Authorization"] == "Bearer second"
    clock[0] += 121
    replies.append(ok())
    groq_client.chat_json("s", "u")  # rested: the first again
    assert sent[-1]["headers"]["Authorization"] == "Bearer first"


@pytest.mark.parametrize("failure", [httpx.Response(503, json=[{"error": {"message": "high demand"}}]),
                                     httpx.Response(404, json={"error": {"message": "model gone"}}),
                                     httpx.ReadTimeout("slow")])
def test_overload_a_gone_model_or_a_timeout_also_go_to_the_fallback(use, monkeypatch, failure):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="groq", GROQ_API_KEY="gk")
    urls = []

    def post(url, json=None, headers=None, timeout=None):
        urls.append(url)
        if "googleapis" in url:
            if isinstance(failure, Exception):
                raise failure
            return failure
        return httpx.Response(200, json=ok(model="qwen"))
    monkeypatch.setattr(groq_client.httpx, "post", post)
    data, model = groq_client.chat_json("s", "u")
    assert data == {"ok": True} and model == "qwen/qwen3.8-27b"  # stored with the model that wrote it
    assert ["googleapis" in u for u in urls] == [True, False]


def test_a_bad_request_is_not_retried_elsewhere(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="groq", GROQ_API_KEY="gk")
    sent, replies = wire
    replies.append(httpx.Response(400, json={"error": {"message": "Invalid argument"}}))
    with pytest.raises(groq_client.GroqError):
        groq_client.chat_json("s", "u")
    assert len(sent) == 1


def test_a_missing_primary_key_uses_the_fallback(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="", LLM_FALLBACK_PROVIDER="groq", GROQ_API_KEY="gk")
    sent, _ = wire
    groq_client.chat_json("s", "u")
    assert sent[0]["headers"]["Authorization"] == "Bearer gk"


def test_both_down_reports_the_last_error(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="gemini", LLM_FALLBACK_API_KEY="second")
    sent, replies = wire
    replies += [httpx.Response(429, json={"error": {"message": "quota"}})] * 2
    with pytest.raises(groq_client.GroqError) as e:
        groq_client.chat_json("s", "u")
    assert e.value.status == 429 and len(sent) == 2


TOOLS = [{"type": "function", "function": {"name": "reading_stats", "description": "Stats", "parameters": {"type": "object", "properties": {}}}}]


def test_a_chat_answer_continues_on_another_gemini_key_with_placeholder_signatures(use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="gemini", LLM_FALLBACK_API_KEY="second")
    sent, replies = wire
    call = {"id": "c1", "type": "function", "function": {"name": "reading_stats", "arguments": "{}"},
            "extra_content": {"google": {"thought_signature": "real-signature-of-the-first"}}}
    replies += [{"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [call]}}]},
                httpx.Response(429, json={"error": {"message": "quota"}}),
                {"choices": [{"message": {"role": "assistant", "content": "40 minutes."}}]}]
    messages = [{"role": "user", "content": "How much?"}]
    step = groq_client.chat_tools(messages, TOOLS)
    messages += [{"role": "assistant", "content": "", "tool_calls": step["tool_calls"], "_route": step["_route"]},
                 {"role": "tool", "tool_call_id": "c1", "content": "{}"}]
    final = groq_client.chat_tools(messages, TOOLS)
    assert final["content"] == "40 minutes." and final["_route"] != step["_route"]
    retried, on_second = sent[1]["json"]["messages"][1], sent[2]["json"]["messages"][1]
    assert retried["tool_calls"][0]["extra_content"]["google"]["thought_signature"] == "real-signature-of-the-first"
    assert on_second["tool_calls"][0]["extra_content"]["google"]["thought_signature"] == "skip_thought_signature_validator"
    assert "_route" not in on_second


def test_a_chat_answer_moves_from_claude_to_groq(claude, use, wire):
    use(LLM_FALLBACK_PROVIDER="groq", GROQ_API_KEY="gk")
    sent, replies = wire
    blocks = [{"type": "thinking", "thinking": "", "signature": "s"},
              {"type": "tool_use", "id": "tu_1", "name": "reading_stats", "input": {}}]
    claude.replies.append((blocks, "tool_use"))
    messages = [{"role": "user", "content": "How much?"}]
    step = groq_client.chat_tools(messages, TOOLS)
    messages += [{"role": "assistant", "content": "", "tool_calls": step["tool_calls"], "_raw": step["_raw"], "_route": step["_route"]},
                 {"role": "tool", "tool_call_id": "tu_1", "content": "{}"}]

    def overloaded(**kwargs):
        raise anthropic_llm.ClaudeError("Anthropic answered 529: Overloaded", 529)
    claude.beta.messages.create = overloaded
    replies.append({"choices": [{"message": {"role": "assistant", "content": "40 minutes."}}]})
    assert groq_client.chat_tools(messages, TOOLS)["content"] == "40 minutes."
    groq_msg = sent[0]["json"]["messages"][1]
    assert groq_msg == {"role": "assistant", "content": "", "tool_calls": step["tool_calls"]}  # no Claude blocks, no _ keys


def test_a_chat_answer_moves_from_gemini_to_claude(claude, use, wire):
    use(LLM_PROVIDER="gemini", GEMINI_API_KEY="first", LLM_FALLBACK_PROVIDER="anthropic")
    sent, replies = wire
    call = {"id": "c1", "type": "function", "function": {"name": "reading_stats", "arguments": "{}"},
            "extra_content": {"google": {"thought_signature": "sig"}}}
    replies += [{"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [call]}}]},
                httpx.Response(503, json=[{"error": {"message": "high demand"}}])]
    claude.replies.append(([{"type": "text", "text": "40 minutes."}], "end_turn"))
    messages = [{"role": "user", "content": "How much?"}]
    step = groq_client.chat_tools(messages, TOOLS)
    messages += [{"role": "assistant", "content": "", "tool_calls": step["tool_calls"], "_route": step["_route"]},
                 {"role": "tool", "tool_call_id": "c1", "content": "{}"}]
    assert groq_client.chat_tools(messages, TOOLS)["content"] == "40 minutes."
    assert claude.sent[0]["messages"][1] == {"role": "assistant", "content": [
        {"type": "tool_use", "id": "c1", "name": "reading_stats", "input": {}}]}


def test_what_answered_says_main_or_fallback(use, wire):
    use(LLM_PROVIDER="groq", GROQ_API_KEY="first", LLM_FALLBACK_PROVIDER="groq", LLM_FALLBACK_API_KEY="second")
    sent, replies = wire
    assert groq_client.chat_json_via("s", "u")[1:] == ("qwen/qwen3.8-27b", "main")
    replies += [httpx.Response(429, json={"error": {"message": "limit"}}), ok()]
    assert groq_client.chat_json_via("s", "u")[2] == "fallback"
    replies.append({"choices": [{"message": {"role": "assistant", "content": "hi"}}]})
    assert groq_client.chat_tools([{"role": "user", "content": "hi"}], TOOLS)["_via"] == "fallback"  # the first rests
