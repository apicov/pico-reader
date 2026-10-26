"""The AI's chat completions, in JSON mode or with tools, from tsp-publisher (app/describe.py call_groq): the reply's
shape is spelled out in the prompt, and an unusable reply is asked for once more.

LLM_PROVIDER picks the AI, LLM_FALLBACK_PROVIDER an optional second one (any of them, or the same one with another
key or model) for when the first is unavailable:
- groq (the default) and gemini speak the same OpenAI-compatible API, here. Gemini thinks before answering, and
  its thinking counts against max_tokens, so its calls get room for it.
- anthropic: Claude through the official SDK (app/anthropic_llm.py), in and out in the same shapes.

Unavailable means a limit (429), a server error (5xx), a timeout or no connection, a missing key, or a key or model
the provider doesn't accept (401/403/404). Then the call goes to the fallback, and the first one rests (as long as
it asked, or a minute after a limit, half a minute otherwise). A bad request or a refusal isn't retried elsewhere.
In the chat an answer can change provider between steps: each message keeps which route wrote it (`_route`), so a
provider gets the others' tool calls in a form it takes (Gemini needs a thought signature on every tool call, and
accepts Google's placeholder for calls it didn't make)."""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, TypeVar

import httpx
from sqlalchemy import text

from app import anthropic_llm
from app.config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")
GEMINI_PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator"
UNAVAILABLE = {401, 403, 404, 408, 409, 429}  # and every 5xx


@dataclass
class Route:
    """One provider with its key and models: the primary, or the fallback."""
    kind: str  # groq | gemini | anthropic
    api_key: str
    key_setting: str  # where the key goes, for the error message
    model: str
    agent_model: str
    base_url: str = ""
    extra: dict[str, Any] = field(default_factory=dict)  # sent with every request (OpenAI-compatible ones)
    thinking_room: int = 0  # added to max_tokens

    @property
    def name(self) -> str:
        return {"groq": "Groq", "gemini": "Gemini", "anthropic": "Anthropic"}[self.kind]

    @property
    def id(self) -> str:
        return f"{self.kind}:{self.model}:{self.api_key[-6:]}"


def _route(kind: str, api_key: str | None = None, key_setting: str = "", model_name: str = "",
           agent_model: str = "") -> Route:
    s = get_settings()
    kind = kind.lower()
    if kind == "gemini":
        model_name = model_name or s.gemini_model
        return Route("gemini", s.gemini_api_key if api_key is None else api_key, key_setting or "GEMINI_API_KEY",
                     model_name, agent_model or s.gemini_agent_model or model_name, s.gemini_base_url.rstrip("/"),
                     {"reasoning_effort": s.gemini_reasoning_effort} if s.gemini_reasoning_effort else {}, 2048)
    if kind == "anthropic":
        model_name = model_name or s.anthropic_model
        return Route("anthropic", s.anthropic_api_key if api_key is None else api_key, key_setting or "ANTHROPIC_API_KEY",
                     model_name, agent_model or s.anthropic_agent_model or model_name)
    if kind != "groq":
        raise GroqError(f"Unknown AI provider {kind!r} (groq, gemini or anthropic)", 503)
    model_name = model_name or s.groq_model
    extra: dict[str, Any] = {}
    if s.groq_reasoning_format and "qwen" in model_name:
        extra["reasoning_format"] = s.groq_reasoning_format
    if "gpt-oss" in model_name:
        extra["reasoning_effort"] = "low"
    return Route("groq", s.groq_api_key if api_key is None else api_key, key_setting or "GROQ_API_KEY", model_name,
                 agent_model or s.groq_agent_model or model_name, s.groq_base_url.rstrip("/"), extra)


def routes() -> list[Route]:
    """The primary, and the fallback when there is one."""
    s = get_settings()
    out = [_route(s.llm_provider)]
    if s.llm_fallback_provider:
        out.append(_route(s.llm_fallback_provider, s.llm_fallback_api_key or None,
                          "LLM_FALLBACK_API_KEY" if s.llm_fallback_api_key else "", s.llm_fallback_model,
                          s.llm_fallback_agent_model))
    return out


def model() -> str:
    """The primary's model (what translations and definitions are normally written by)."""
    return routes()[0].model


class GroqError(Exception):
    """The AI couldn't be used: no key, unreachable, an error answer. `status` is what the API passes on;
    `unavailable`: worth trying the fallback."""

    def __init__(self, message: str, status: int = 502, unavailable: bool = False, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.unavailable = unavailable
        self.retry_after = retry_after


class UnusableReply(Exception):
    pass


_resting: dict[str, float] = {}  # route id → until when it's left out


def _with_fallback(call: Callable[[Route], T]) -> T:
    """`call` on the primary, or on the fallback when the primary is unavailable (or resting)."""
    all_routes = routes()
    now = time.monotonic()
    ready = [r for r in all_routes if _resting.get(r.id, 0) <= now] or all_routes  # all resting: try them anyway
    for i, route in enumerate(ready):
        try:
            return call(route)
        except GroqError as e:
            if not e.unavailable or i == len(ready) - 1:
                raise
            rest = e.retry_after or (60 if e.status == 429 else 30)
            _resting[route.id] = time.monotonic() + rest
            logger.warning("%s unavailable (%s); using %s, and leaving it out for %.0f s", route.name, e, ready[i + 1].name, rest)
    raise AssertionError("unreachable")


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
    def ask(route: Route) -> tuple[dict[str, Any], str]:
        for attempt in (1, 2):
            try:
                reply = _call(route, system, user, max_tokens)
                _record(who, reply)
                return _parse(reply), route.model
            except UnusableReply as e:
                if attempt == 2:
                    raise GroqError(f"The model's answer wasn't usable: {e}") from e
                logger.warning("Unusable AI reply, asking again: %s", e)
        raise AssertionError("unreachable")
    return _with_fallback(ask)


def chat_tools(messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int = 1500,
               who: Who = None) -> dict[str, Any]:
    """One step of the agent: the model's message, with `tool_calls` when it wants tools run. The caller passes it
    back with the next step as it came, its `_` keys included: `_route` (who wrote it), Claude's `_raw` blocks."""
    def step(route: Route) -> dict[str, Any]:
        if route.kind == "anthropic":
            message, usage = _claude(route, lambda: anthropic_llm.chat_tools(messages, tools, max_tokens, route.api_key,
                                                                           route.agent_model, _timeout()))
            _record(who, usage)
            return {**message, "_route": route.id}
        payload = {**_payload(route, _for_openai(route, messages), max_tokens), "tools": tools, "tool_choice": "auto",
                   "model": route.agent_model}
        res = _post(route, payload)
        if res.status_code != 200:
            raise _failed(route, res)
        try:
            body = res.json()
            message = body["choices"][0]["message"]
        except (KeyError, IndexError, ValueError) as e:
            raise GroqError(f"{route.name} sent no message", unavailable=True) from e
        _record(who, body)
        return {**message, "_route": route.id}
    return _with_fallback(step)


def _for_openai(route: Route, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The messages as this OpenAI-compatible provider takes them: without the app's `_` keys, and the tool calls of
    other routes with a placeholder thought signature (Gemini) or without Google's extra fields (Groq)."""
    out = []
    for m in messages:
        plain = {k: v for k, v in m.items() if not k.startswith("_")}
        if plain.get("tool_calls") and m.get("_route") != route.id:
            calls = []
            for c in plain["tool_calls"]:
                c = {k: v for k, v in c.items() if k != "extra_content"}
                if route.kind == "gemini":
                    c["extra_content"] = {"google": {"thought_signature": GEMINI_PLACEHOLDER_SIGNATURE}}
                calls.append(c)
            plain["tool_calls"] = calls
        out.append(plain)
    return out


def _timeout() -> float:
    return get_settings().llm_timeout


def _payload(route: Route, messages: list[dict[str, Any]], max_tokens: int) -> dict[str, Any]:
    if not route.api_key:
        raise GroqError(f"{route.key_setting} is not set on the server", 503, unavailable=True)
    return {"model": route.model, "messages": messages, "max_tokens": max_tokens + route.thinking_room,
            "temperature": 0.2, **route.extra}


def _post(route: Route, payload: dict[str, Any]) -> httpx.Response:
    try:
        return httpx.post(f"{route.base_url}/chat/completions", json=payload, timeout=_timeout(),
                          headers={"Authorization": f"Bearer {route.api_key}"})
    except httpx.HTTPError as e:
        raise GroqError(f"Could not reach {route.name}: {e}", unavailable=True) from e


def _failed(route: Route, res: httpx.Response) -> GroqError:
    logger.error("%s error %s: %s", route.name, res.status_code, res.text[:500])
    try:
        retry_after = float(res.headers.get("retry-after", ""))
    except ValueError:
        retry_after = None
    return GroqError(f"{route.name} answered {res.status_code}: {_error_message(res)}",
                     429 if res.status_code == 429 else 502,
                     unavailable=res.status_code in UNAVAILABLE or res.status_code >= 500, retry_after=retry_after)


def _claude(route: Route, call: Callable[[], T]) -> T:
    if not route.api_key:
        raise GroqError(f"{route.key_setting} is not set on the server", 503, unavailable=True)
    try:
        return call()
    except anthropic_llm.ClaudeError as e:
        raise GroqError(str(e), 429 if e.status == 429 else 422 if e.status == 422 else 502,
                        unavailable=e.status == 0 or e.status in UNAVAILABLE or e.status >= 500) from e


def _call(route: Route, system: str, user: str, max_tokens: int) -> dict[str, Any]:
    if route.kind == "anthropic":
        return _claude(route, lambda: anthropic_llm.chat_json(system, user, max_tokens, route.api_key, route.model,
                                                             _timeout()))
    payload = {**_payload(route, [{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens),
               "response_format": {"type": "json_object"}}
    res = _post(route, payload)
    if res.status_code == 400 and "response_format" in res.text:
        # no JSON mode: the prompt spells out the shape, and _parse finds the object in the text
        payload.pop("response_format")
        res = _post(route, payload)
    if res.status_code != 200:
        if "json_validate_failed" in res.text:
            logger.error("%s error %s: %s", route.name, res.status_code, res.text[:500])
            raise UnusableReply(_error_message(res))
        raise _failed(route, res)
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
