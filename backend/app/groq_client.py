"""Groq chat completions in JSON mode, from tsp-publisher (app/describe.py call_groq): the reply's shape is
spelled out in the prompt, and an unusable reply is asked for once more."""

import json
import logging
import re
from collections.abc import Iterator
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class GroqError(Exception):
    """Groq couldn't be used: no key, unreachable, an error answer. `status` is what the API passes on."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class UnusableReply(Exception):
    pass


def chat_json(system: str, user: str, max_tokens: int = 1500) -> tuple[dict[str, Any], str]:
    """(the reply's JSON object, the model that wrote it); one retry when the JSON is unusable."""
    for attempt in (1, 2):
        try:
            return _parse(_call(system, user, max_tokens)), get_settings().groq_model
        except UnusableReply as e:
            if attempt == 2:
                raise GroqError(f"The model's answer wasn't usable: {e}") from e
            logger.warning("Unusable Groq reply, asking again: %s", e)
    raise AssertionError("unreachable")


def _payload(messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
    settings = get_settings()
    if not settings.groq_api_key:
        raise GroqError("GROQ_API_KEY is not set on the server", 503)
    payload: dict[str, Any] = {"model": settings.groq_model, "messages": messages, "max_tokens": max_tokens,
                               "temperature": 0.2}
    if settings.groq_reasoning_format and "qwen" in settings.groq_model:
        payload["reasoning_format"] = settings.groq_reasoning_format
    if "gpt-oss" in settings.groq_model:
        payload["reasoning_effort"] = "low"
    return payload


def chat_stream(messages: list[dict[str, str]], max_tokens: int = 1500) -> Iterator[str]:
    """The reply's text as it is written (Groq's server-sent events), for chat answers."""
    settings = get_settings()
    payload = {**_payload(messages, max_tokens), "stream": True}
    try:
        with httpx.stream("POST", f"{settings.groq_base_url}/chat/completions", json=payload, timeout=120,
                          headers={"Authorization": f"Bearer {settings.groq_api_key}"}) as res:
            if res.status_code != 200:
                res.read()
                logger.error("Groq error %s: %s", res.status_code, res.text[:500])
                raise GroqError(f"Groq answered {res.status_code}: {_error_message(res)}",
                                429 if res.status_code == 429 else 502)
            for line in res.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    piece = json.loads(data)["choices"][0]["delta"].get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if piece:
                    yield piece
    except httpx.HTTPError as e:
        raise GroqError(f"Could not reach Groq: {e}") from e


def chat_tools(messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int = 1500) -> dict[str, Any]:
    """One step of the agent: the model's message, with `tool_calls` when it wants tools run."""
    settings = get_settings()
    payload = {**_payload(messages, max_tokens), "tools": tools, "tool_choice": "auto",
               "model": settings.groq_agent_model or settings.groq_model}
    try:
        res = httpx.post(f"{settings.groq_base_url}/chat/completions", json=payload, timeout=90,
                         headers={"Authorization": f"Bearer {settings.groq_api_key}"})
    except httpx.HTTPError as e:
        raise GroqError(f"Could not reach Groq: {e}") from e
    if res.status_code != 200:
        logger.error("Groq error %s: %s", res.status_code, res.text[:500])
        raise GroqError(f"Groq answered {res.status_code}: {_error_message(res)}", 429 if res.status_code == 429 else 502)
    try:
        return res.json()["choices"][0]["message"]
    except (KeyError, IndexError, ValueError) as e:
        raise GroqError("Groq sent no message") from e


def _call(system: str, user: str, max_tokens: int) -> dict[str, Any]:
    settings = get_settings()
    payload = {**_payload([{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens),
               "response_format": {"type": "json_object"}}
    try:
        res = httpx.post(f"{settings.groq_base_url}/chat/completions", json=payload, timeout=60,
                         headers={"Authorization": f"Bearer {settings.groq_api_key}"})
    except httpx.HTTPError as e:
        raise GroqError(f"Could not reach Groq: {e}") from e
    if res.status_code != 200:
        logger.error("Groq error %s: %s", res.status_code, res.text[:500])
        if "json_validate_failed" in res.text:
            raise UnusableReply(_error_message(res))
        raise GroqError(f"Groq answered {res.status_code}: {_error_message(res)}",
                        429 if res.status_code == 429 else 502)
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
        return res.json()["error"]["message"]
    except Exception:
        return res.text[:200]
