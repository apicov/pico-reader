"""Conversations with the library: an agent that answers with the conversation so far and the app's data.

One turn: the model gets the recent turns and the library overview, calls tools (agent_tools.py: book passages,
statistics, lookups, translations, highlights, review, goal) for up to MAX_ROUNDS rounds, then answers. The turn
streams as server-sent events: tool / link / action events as they happen, then the sources, the answer text and
done. Tools that change something are only proposed (action); /actions/{id} runs them once the reader confirms.
"""

import json
import logging
import uuid
from collections.abc import Iterator
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import groq_client
from app.auth import Reader, get_current_reader
from app.db import get_db, get_engine
from app.routes.search import CITATION_RULES, Passage, books_named, library_overview

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/conversations", tags=["chat"])

HISTORY_TURNS = 6  # earlier messages the model sees
HISTORY_CHARS = 6000  # and at most this much of them


class ConversationIn(BaseModel):
    id: str = Field(min_length=8, max_length=64)
    title: str = Field(default="", max_length=200)
    book_ids: list[str] | None = None


class ConversationPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    book_ids: list[str] | None = None
    all_books: bool = False  # book_ids can't say "null" in a patch; this does


class Conversation(BaseModel):
    id: str
    title: str
    book_ids: list[str] | None
    created_at: datetime
    updated_at: datetime
    snippet: str = ""  # the last message, for the list


class Message(BaseModel):
    id: int
    role: str
    content: str
    sources: list[Passage]
    created_at: datetime
    extras: dict = {}  # tools used, links offered, actions proposed (with their current status)


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    tz: str = "UTC"  # the reader's time zone, for statistics in their days


def _own(db: Session, reader: Reader, conversation_id: str):
    row = db.execute(text("""SELECT id, title, book_ids, created_at, updated_at FROM conversations
                             WHERE id = :id AND reader_email = :e"""), {"id": conversation_id, "e": reader.email}).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")
    return row


@router.get("", response_model=list[Conversation])
def conversations(q: str = "", reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Newest first; `q` searches titles and messages."""
    match = ""
    if q.strip():
        match = """AND (c.title ILIKE '%' || :q || '%' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id
                   AND (to_tsvector('simple', m.content) @@ websearch_to_tsquery('simple', :q)
                        OR m.content ILIKE '%' || :q || '%')))"""
    rows = db.execute(text(f"""
        SELECT c.id, c.title, c.book_ids, c.created_at, c.updated_at,
               coalesce((SELECT left(m.content, 160) FROM messages m WHERE m.conversation_id = c.id
                         ORDER BY m.id DESC LIMIT 1), '') AS snippet
        FROM conversations c WHERE c.reader_email = :e {match} ORDER BY c.updated_at DESC LIMIT 200"""),
        {"e": reader.email, "q": q.strip()})
    return [Conversation(**r._mapping) for r in rows]


@router.post("", response_model=Conversation)
def create(body: ConversationIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if db.execute(text("SELECT reader_email FROM conversations WHERE id = :id"), {"id": body.id}).scalar():
        raise HTTPException(409, "That id is taken")
    row = db.execute(text("""INSERT INTO conversations (id, reader_email, title, book_ids)
                             VALUES (:id, :e, :t, CAST(:b AS jsonb)) RETURNING id, title, book_ids, created_at, updated_at"""),
                     {"id": body.id, "e": reader.email, "t": body.title,
                      "b": json.dumps(body.book_ids) if body.book_ids else None}).fetchone()
    db.commit()
    return Conversation(**row._mapping)


@router.patch("/{conversation_id}", response_model=Conversation)
def update(conversation_id: str, body: ConversationPatch, reader: Reader = Depends(get_current_reader),
           db: Session = Depends(get_db)):
    _own(db, reader, conversation_id)
    if body.title is not None:
        db.execute(text("UPDATE conversations SET title = :t WHERE id = :id"), {"t": body.title.strip(), "id": conversation_id})
    if body.book_ids is not None or body.all_books:
        db.execute(text("UPDATE conversations SET book_ids = CAST(:b AS jsonb) WHERE id = :id"),
                   {"b": None if body.all_books or not body.book_ids else json.dumps(body.book_ids), "id": conversation_id})
    db.commit()
    return Conversation(**_own(db, reader, conversation_id)._mapping)


@router.delete("/{conversation_id}", status_code=204)
def delete(conversation_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    _own(db, reader, conversation_id)
    db.execute(text("DELETE FROM conversations WHERE id = :id"), {"id": conversation_id})
    db.commit()


def _messages(db: Session, conversation_id: str) -> list[Message]:
    statuses = dict(db.execute(text("SELECT id, status FROM chat_actions WHERE conversation_id = :id"),
                               {"id": conversation_id}).fetchall())
    out = []
    for r in db.execute(text("""SELECT id, role, content, sources, created_at, extras FROM messages
                                WHERE conversation_id = :id ORDER BY id"""), {"id": conversation_id}):
        m = Message(**r._mapping)
        for a in m.extras.get("actions", []):
            a["status"] = statuses.get(a["id"], a.get("status"))
        out.append(m)
    return out


@router.get("/{conversation_id}")
def conversation(conversation_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    row = _own(db, reader, conversation_id)
    return {"conversation": Conversation(**row._mapping), "messages": _messages(db, conversation_id)}


# --- one turn: the agent ---

MAX_ROUNDS = 5  # tool rounds before the model must answer


def _history(messages: list[Message]) -> list[Message]:
    """The last turns, newest kept whole, within the character budget."""
    kept, size = [], 0
    for m in reversed(messages[-HISTORY_TURNS:]):
        size += len(m.content)
        if kept and size > HISTORY_CHARS:
            break
        kept.append(m)
    return list(reversed(kept))


def _title(content: str) -> str:
    """A short title for a new conversation, in the message's language."""
    try:
        data, _model = groq_client.chat_json(
            "Give a short title (at most 6 words) for a conversation that starts with the MESSAGE, written in the SAME "
            'language as the message. Reply with one JSON object and nothing else: {"title": string}',
            f"MESSAGE: {content}", max_tokens=60)
        return str(data.get("title") or "").strip()[:120] or content[:60]
    except groq_client.GroqError:
        return content[:60]


AGENT_PROMPT = f"""You are the reader's companion for their own library of books, in an ongoing conversation.
You have tools for the books (search_passages finds content: search before answering anything about what a book
says, and search again with other words if needed), the reader's statistics, dictionary lookups, translations,
highlights, review cards and reading goal. Use them whenever data is needed; never invent books, numbers or quotes.
{CITATION_RULES}
For changes (set_reading_goal, mark_known, add_review_cards) call the tool: the reader confirms in the chat, so
say what you proposed. open_book_at and export_anki show buttons; mention them briefly.
Write plain text with light Markdown (short paragraphs, "- " lists, **bold** for key terms).
Today is {{today}}. {{scope}}

LIBRARY:
{{library}}"""

TOOL_LABELS = {"list_books": "library", "book_details": "book details", "search_passages": "searched the books",
               "reading_stats": "reading statistics", "lookup_stats": "lookup statistics", "translations": "translations",
               "highlights": "highlights", "vocabulary_due": "review cards", "reading_goal": "reading goal",
               "open_book_at": "book link", "export_anki": "Anki export"}


def _event(name: str, data) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _scope_note(db: Session, book_ids: list[str] | None) -> str:
    if not book_ids:
        return "The reader asks about the whole library."
    titles = db.execute(text("SELECT title FROM books WHERE id = ANY(:b)"), {"b": book_ids}).scalars().all()
    return f"This conversation is about: {', '.join(titles)} (search those books unless told otherwise)."


@router.post("/{conversation_id}/messages")
def send(conversation_id: str, body: MessageIn, reader: Reader = Depends(get_current_reader),
         db: Session = Depends(get_db)):
    from sqlalchemy.orm import sessionmaker

    from app import agent_tools

    convo = _own(db, reader, conversation_id)
    earlier = _messages(db, conversation_id)
    content = body.content.strip()
    user_id = db.execute(text("""INSERT INTO messages (conversation_id, role, content) VALUES (:c, 'user', :t)
                                 RETURNING id"""), {"c": conversation_id, "t": content}).scalar()
    db.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :id"), {"id": conversation_id})
    db.commit()
    first = not earlier and not convo.title
    book_ids = convo.book_ids or books_named(db, content) or None

    def stream() -> Iterator[str]:
        # the request's session is closed once a streamed body runs: the agent gets a session of its own
        session = sessionmaker(bind=get_engine())()
        try:
            ctx = agent_tools.Context(db=session, reader=reader, tz=body.tz, sources=[])
            today = datetime.now().date().isoformat()
            messages: list[dict] = [{"role": "system", "content": AGENT_PROMPT.format(
                today=today, scope=_scope_note(session, book_ids), library=library_overview(session))}]
            for m in _history(earlier):
                messages.append({"role": m.role, "content": m.content})
            messages.append({"role": "user", "content": content})
            schemas = [t.schema() for t in agent_tools.TOOLS.values()]
            extras: dict = {"tools": [], "links": [], "actions": []}
            answer = ""
            for _round in range(MAX_ROUNDS):
                reply = groq_client.chat_tools(messages, schemas, max_tokens=1500)
                calls = reply.get("tool_calls") or []
                if not calls:
                    answer = (reply.get("content") or "").strip()
                    break
                messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
                for call in calls:
                    name = call["function"]["name"]
                    raw = call["function"].get("arguments") or "{}"
                    tool = agent_tools.TOOLS.get(name)
                    if tool and tool.changes:
                        # proposed, not run: the reader confirms in the chat
                        try:
                            args = json.loads(raw)
                        except json.JSONDecodeError:
                            args = {}
                        action = {"id": f"act-{uuid.uuid4()}", "tool": name, "args": args,
                                  "label": tool.label(args) or name, "status": "pending"}
                        session.execute(text("""INSERT INTO chat_actions (id, conversation_id, tool, args, label)
                                                VALUES (:id, :c, :t, CAST(:a AS jsonb), :l)"""),
                                        {"id": action["id"], "c": conversation_id, "t": name, "a": json.dumps(args),
                                         "l": action["label"]})
                        session.commit()
                        extras["actions"].append({k: action[k] for k in ("id", "label", "status")})
                        yield _event("action", extras["actions"][-1])
                        result = {"status": "proposed; the reader is asked to confirm in the chat"}
                    else:
                        result = agent_tools.run(ctx, name, raw)
                        label = TOOL_LABELS.get(name, name)
                        if label not in extras["tools"]:
                            extras["tools"].append(label)
                            yield _event("tool", {"name": name, "label": label})
                        if isinstance(result, dict) and "link" in result:
                            extras["links"].append(result["link"])
                            yield _event("link", result["link"])
                    messages.append({"role": "tool", "tool_call_id": call.get("id", name),
                                     "content": json.dumps(result, ensure_ascii=False, default=str)[:12000]})
            else:
                answer = "I needed too many steps for that; could you ask more specifically?"
            sources = [p.model_dump() for p in ctx.sources]
            yield _event("sources", sources)
            for i in range(0, len(answer), 24):  # the answer comes in one piece from the agent: hand it on in steps
                yield _event("delta", answer[i:i + 24])
            title = _title(content) if first else ""
            with get_engine().begin() as conn:
                assistant_id = conn.execute(text("""
                    INSERT INTO messages (conversation_id, role, content, sources, extras)
                    VALUES (:c, 'assistant', :t, CAST(:s AS jsonb), CAST(:x AS jsonb)) RETURNING id"""),
                    {"c": conversation_id, "t": answer, "s": json.dumps(sources, ensure_ascii=False, default=str),
                     "x": json.dumps(extras, ensure_ascii=False, default=str)}).scalar()
                if title:
                    conn.execute(text("UPDATE conversations SET title = :t WHERE id = :id AND title = ''"),
                                 {"t": title, "id": conversation_id})
                conn.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :id"), {"id": conversation_id})
            yield _event("done", {"user_message_id": user_id, "assistant_message_id": assistant_id,
                                  "title": title or convo.title})
        except groq_client.GroqError as e:
            yield _event("error", {"message": str(e), "user_message_id": user_id})
        finally:
            session.close()

    # no-transform: keep proxies from buffering or compressing the stream
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


class ActionDecision(BaseModel):
    approve: bool


@router.post("/{conversation_id}/actions/{action_id}", response_model=Message)
def decide(conversation_id: str, action_id: str, body: ActionDecision, tz: str = "UTC",
           reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The reader confirms (or cancels) a change the agent proposed; the outcome becomes a chat message."""
    from app import agent_tools

    _own(db, reader, conversation_id)
    action = db.execute(text("""SELECT id, tool, args, label, status FROM chat_actions
                                WHERE id = :id AND conversation_id = :c FOR UPDATE"""),
                        {"id": action_id, "c": conversation_id}).fetchone()
    if action is None:
        raise HTTPException(404, "Not found")
    if action.status != "pending":
        raise HTTPException(409, f"Already {action.status}")
    if body.approve:
        ctx = agent_tools.Context(db=db, reader=reader, tz=tz, sources=[])
        result = agent_tools.run(ctx, action.tool, action.args)
        failed = isinstance(result, dict) and "error" in result
        status, content = ("failed", f"Couldn't do it: {result['error']}") if failed else ("done", f"Done: {action.label}.")
    else:
        status, content = "cancelled", f"Cancelled: {action.label}."
    db.execute(text("UPDATE chat_actions SET status = :s WHERE id = :id"), {"s": status, "id": action_id})
    row = db.execute(text("""INSERT INTO messages (conversation_id, role, content) VALUES (:c, 'assistant', :t)
                             RETURNING id, role, content, sources, created_at"""), {"c": conversation_id, "t": content}).fetchone()
    db.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :id"), {"id": conversation_id})
    db.commit()
    return Message(**row._mapping)
