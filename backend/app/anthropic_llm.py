"""Claude (Anthropic's Messages API, official SDK) behind the same calls as the OpenAI-compatible providers in
groq_client: messages and tools come in the chat-completions shape the app uses, and go back in it.

- The system message becomes `system`; tool results (role "tool") become one user message of `tool_result` blocks.
- Claude thinks before answering (adaptive thinking; `effort` from ANTHROPIC_EFFORT) and its thinking counts against
  max_tokens, so calls get room for it. A tool step's content blocks, thinking included, are passed back unchanged
  under `_raw` (the history stays append-only, as Claude's thinking blocks require).
- A request the safety classifiers decline is re-run on Anthropic's recommended fallback model (server-side
  `fallbacks: "default"`); a refusal after that is an error for the caller.
"""

import json
from functools import lru_cache
from typing import Any

import anthropic

from app.config import get_settings

FALLBACK_BETA = "server-side-fallback-2026-07-01"
THINKING_ROOM = 4000


class ClaudeError(Exception):
    """`status`: the API's HTTP status; 0 when it couldn't be reached, 422 for a refusal."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


@lru_cache
def _client(api_key: str, timeout: float) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key, timeout=timeout)


def _convert(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """(system, messages) for the Messages API from chat-completions messages."""
    system: list[str] = []
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        if role == "system":
            system.append(m["content"])
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m.get("content") or ""}
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list) \
                    and all(b.get("type") == "tool_result" for b in out[-1]["content"]):
                out[-1]["content"].append(block)  # every result of one step in one message
            else:
                out.append({"role": "user", "content": [block]})
        elif role == "assistant" and m.get("_raw"):
            out.append({"role": "assistant", "content": m["_raw"]})  # as Claude wrote it, thinking included
        elif role == "assistant" and m.get("tool_calls"):
            content: list[dict[str, Any]] = [{"type": "text", "text": m["content"]}] if m.get("content") else []
            content += [{"type": "tool_use", "id": c["id"], "name": c["function"]["name"],
                         "input": json.loads(c["function"].get("arguments") or "{}")} for c in m["tool_calls"]]
            out.append({"role": "assistant", "content": content})
        else:
            out.append({"role": role, "content": m.get("content") or ""})
    return "\n\n".join(system), out


def _tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"name": t["function"]["name"], "description": t["function"].get("description", ""),
             "input_schema": t["function"].get("parameters") or {"type": "object", "properties": {}}} for t in tools]


def _create(api_key: str, model: str, timeout: float, max_tokens: int, system: str, messages: list[dict[str, Any]],
            tools: list[dict[str, Any]] | None = None):
    s = get_settings()
    kwargs: dict[str, Any] = {"model": model, "max_tokens": max_tokens + THINKING_ROOM, "messages": messages,
                              "betas": [FALLBACK_BETA], "fallbacks": "default"}
    if system:
        kwargs["system"] = system
    if tools:
        kwargs["tools"] = tools
    if s.anthropic_effort:
        kwargs["output_config"] = {"effort": s.anthropic_effort}
    try:
        response = _client(api_key, timeout).beta.messages.create(**kwargs)
    except anthropic.RateLimitError as e:
        raise ClaudeError(f"Anthropic answered 429: {e.message}", 429) from e
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"Anthropic answered {e.status_code}: {e.message}", e.status_code) from e
    except anthropic.APIConnectionError as e:  # timeouts too
        raise ClaudeError(f"Could not reach Anthropic: {e}", 0) from e
    if response.stop_reason == "refusal":
        raise ClaudeError("Claude declined to answer this", 422)
    return response


def _usage(response) -> dict[str, Any]:
    """The chat-completions shape groq_client records: model and tokens in/out."""
    return {"model": response.model, "usage": {"prompt_tokens": response.usage.input_tokens,
                                              "completion_tokens": response.usage.output_tokens}}


def _text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text")


def chat_json(system: str, user: str, max_tokens: int, api_key: str, model: str, timeout: float) -> dict[str, Any]:
    """A completion whose text is the JSON object the prompt describes, in the chat-completions shape."""
    response = _create(api_key, model, timeout, max_tokens, system, [{"role": "user", "content": user}])
    return {**_usage(response), "choices": [{"message": {"role": "assistant", "content": _text(response)}}]}


def chat_tools(messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int, api_key: str, model: str,
               timeout: float) -> tuple[dict[str, Any], dict[str, Any]]:
    """(the model's message with `tool_calls` and `_raw`, the usage to record) for one agent step."""
    system, converted = _convert(messages)
    response = _create(api_key, model, timeout, max_tokens, system, converted, _tools(tools))
    calls = [{"id": b.id, "type": "function", "function": {"name": b.name, "arguments": json.dumps(b.input)}}
             for b in response.content if b.type == "tool_use"]
    message: dict[str, Any] = {"role": "assistant", "content": _text(response),
                               "_raw": [b.model_dump(mode="json", exclude_none=True) for b in response.content]}
    if calls:
        message["tool_calls"] = calls
    return message, _usage(response)
