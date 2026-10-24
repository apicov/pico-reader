"""Groq chat completions in JSON mode, from tsp-publisher (app/describe.py call_groq): the reply's shape is
spelled out in the prompt, and an unusable reply is asked for once more."""

import json
import logging
import re
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


def _call(system: str, user: str, max_tokens: int) -> dict[str, Any]:
    settings = get_settings()
    if not settings.groq_api_key:
        raise GroqError("GROQ_API_KEY is not set on the server", 503)
    payload: dict[str, Any] = {
        "model": settings.groq_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    if settings.groq_reasoning_format and "qwen" in settings.groq_model:
        payload["reasoning_format"] = settings.groq_reasoning_format
    if "gpt-oss" in settings.groq_model:
        payload["reasoning_effort"] = "low"
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
