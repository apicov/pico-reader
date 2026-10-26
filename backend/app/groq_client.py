"""The AI's chat completions, in JSON mode or with tools, from tsp-publisher (app/describe.py call_groq): the reply's
shape is spelled out in the prompt, and an unusable reply is asked for once more.

LLM_PROVIDER picks the AI:
- groq (the default) and gemini speak the same OpenAI-compatible API, here. Gemini thinks before answering, and
  its thinking counts against max_tokens, so its calls get room for it.
- anthropic: Claude through the official SDK (app/anthropic_llm.py), in and out in the same shapes."""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import text

from app import anthropic_llm
from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class Provider:
    """An OpenAI-compatible provider (Groq or Gemini)."""
    name: str
    base_url: str
    api_key: str
    key_setting: str  # the setting to put the key in, for the error message
    model: str
    agent_model: str
    extra: dict[str, Any] = field(default_factory=dict)  # sent with every request
    thinking_room: int = 0  # added to max_tokens


def _anthropic() -> bool:
    return get_settings().llm_provider.lower() == "anthropic"


def provider() -> Provider:
    s = get_settings()
    if s.llm_provider.lower() == "gemini":
        return Provider("Gemini", s.gemini_base_url.rstrip("/"), s.gemini_api_key, "GEMINI_API_KEY", s.gemini_model,
                        s.gemini_agent_model or s.gemini_model,
                        {"reasoning_effort": s.gemini_reasoning_effort} if s.gemini_reasoning_effort else {}, 2048)
    extra: dict[str, Any] = {}
    if s.groq_reasoning_format and "qwen" in s.groq_model:
        extra["reasoning_format"] = s.groq_reasoning_format
    if "gpt-oss" in s.groq_model:
        extra["reasoning_effort"] = "low"
    return Provider("Groq", s.groq_base_url.rstrip("/"), s.groq_api_key, "GROQ_API_KEY", s.groq_model,
                    s.groq_agent_model or s.groq_model, extra)


def model() -> str:
    """The model that writes translations and definitions (stored with them)."""
    return get_settings().anthropic_model if _anthropic() else provider().model


class GroqError(Exception):
    """The AI couldn't be used: no key, unreachable, an error answer. `status` is what the API passes on."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class UnusableReply(Exception):
    pass


# Who a call is for and why: (reader email, purpose). Every call with one is recorded in llm_usage.
Who = tuple[str, str] | None


def _record(who: Who, reply: dict[str, Any]) -> None:
    """Save the tokens a reply used; never lets a bookkeeping problem fail the call."""
    usage = reply.get("usage") or (reply.get("x_groq") or {}).get("usage")
    if not who or not usage:
        return
    try:
        from app.db import get_engine

        with get_engine().begin() as conn:
            conn.execute(text("""INSERT INTO llm_usage (reader_email, purpose, model, prompt_tokens, completion_tokens)
                                 VALUES (:e, :p, :m, :i, :o)"""),
                         {"e": who[0], "p": who[1], "m": reply.get("model", ""),
                          "i": int(usage.get("prompt_tokens") or 0), "o": int(usage.get("completion_tokens") or 0)})
    except Exception:
        logger.exception("Token usage not recorded")


def chat_json(system: str, user: str, max_tokens: int = 1500, who: Who = None) -> tuple[dict[str, Any], str]:
    """(the reply's JSON object, the model that wrote it); one retry when the JSON is unusable."""
    for attempt in (1, 2):
        try:
            reply = _call(system, user, max_tokens)
            _record(who, reply)
            return _parse(reply), model()
        except UnusableReply as e:
            if attempt == 2:
                raise GroqError(f"The model's answer wasn't usable: {e}") from e
            logger.warning("Unusable AI reply, asking again: %s", e)
    raise AssertionError("unreachable")


def _payload(p: Provider, messages: list[dict[str, Any]], max_tokens: int) -> dict[str, Any]:
    if not p.api_key:
        raise GroqError(f"{p.key_setting} is not set on the server", 503)
    # keys starting with _ are the app's own (another provider's raw blocks): not for this API
    plain = [{k: v for k, v in m.items() if not k.startswith("_")} for m in messages]
    return {"model": p.model, "messages": plain, "max_tokens": max_tokens + p.thinking_room, "temperature": 0.2,
            **p.extra}


def _post(p: Provider, payload: dict[str, Any], timeout: float) -> httpx.Response:
    try:
        return httpx.post(f"{p.base_url}/chat/completions", json=payload, timeout=timeout,
                          headers={"Authorization": f"Bearer {p.api_key}"})
    except httpx.HTTPError as e:
        raise GroqError(f"Could not reach {p.name}: {e}") from e


def _failed(p: Provider, res: httpx.Response) -> GroqError:
    logger.error("%s error %s: %s", p.name, res.status_code, res.text[:500])
    return GroqError(f"{p.name} answered {res.status_code}: {_error_message(res)}", 429 if res.status_code == 429 else 502)


def chat_tools(messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int = 1500,
               who: Who = None) -> dict[str, Any]:
    """One step of the agent: the model's message, with `tool_calls` when it wants tools run. The caller passes it
    back with the next step as it came (Gemini's tool calls carry thought signatures, Claude's `_raw` its thinking)."""
    if _anthropic():
        try:
            message, usage = anthropic_llm.chat_tools(messages, tools, max_tokens)
        except anthropic_llm.ClaudeError as e:
            raise GroqError(str(e), e.status) from e
        _record(who, usage)
        return message
    p = provider()
    payload = {**_payload(p, messages, max_tokens), "tools": tools, "tool_choice": "auto", "model": p.agent_model}
    res = _post(p, payload, 90)
    if res.status_code != 200:
        raise _failed(p, res)
    try:
        body = res.json()
        message = body["choices"][0]["message"]
    except (KeyError, IndexError, ValueError) as e:
        raise GroqError(f"{p.name} sent no message") from e
    _record(who, body)
    return message


def _call(system: str, user: str, max_tokens: int) -> dict[str, Any]:
    if _anthropic():
        try:
            return anthropic_llm.chat_json(system, user, max_tokens)
        except anthropic_llm.ClaudeError as e:
            raise GroqError(str(e), e.status) from e
    p = provider()
    payload = {**_payload(p, [{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens),
               "response_format": {"type": "json_object"}}
    res = _post(p, payload, 60)
    if res.status_code == 400 and "response_format" in res.text:
        # a provider without JSON mode: the prompt spells out the shape, _parse finds the object in the text
        payload.pop("response_format")
        res = _post(p, payload, 60)
    if res.status_code != 200:
        if "json_validate_failed" in res.text:
            logger.error("%s error %s: %s", p.name, res.status_code, res.text[:500])
            raise UnusableReply(_error_message(res))
        raise _failed(p, res)
    return res.json()


def _parse(reply: dict[str, Any]) -> dict[str, Any]:
    try:
        text = reply["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise UnusableReply("no message in the reply") from e
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise UnusableReply("no JSON object")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise UnusableReply(str(e)) from e
    if not isinstance(data, dict):
        raise UnusableReply("not a JSON object")
    return data


def _error_message(res: httpx.Response) -> str:
    try:
        body = res.json()
        body = body[0] if isinstance(body, list) else body  # Gemini sometimes answers with a list
        return body["error"]["message"]
    except Exception:
        return res.text[:200]
