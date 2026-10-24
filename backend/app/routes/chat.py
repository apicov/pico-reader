"""Conversations with the library: follow-up questions use the conversation so far.

One turn: the newest question is rewritten (with the recent turns) into a standalone search question, worded
for each indexed book's language; the best passages are found; the answer streams back as server-sent events
(sources first, then the text as it's written) and both messages are stored.
"""

import json
import logging
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
from app.routes.search import (CITATION_RULES, Passage, books_named, library_overview, numbered_sources, retrieve)
from app.routes.translate import LANGUAGES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/conversations", tags=["chat"])

HISTORY_TURNS = 6  # earlier messages the model sees
HISTORY_CHARS = 6000  # and at most this much of them
SOURCES = 8


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


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


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
    rows = db.execute(text("""SELECT id, role, content, sources, created_at FROM messages
                              WHERE conversation_id = :id ORDER BY id"""), {"id": conversation_id})
    return [Message(**r._mapping) for r in rows]


@router.get("/{conversation_id}")
def conversation(conversation_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    row = _own(db, reader, conversation_id)
    return {"conversation": Conversation(**row._mapping), "messages": _messages(db, conversation_id)}


# --- one turn ---

REWRITE_PROMPT = """You prepare the search for a chat about the reader's books. From the CONVERSATION and the
NEW MESSAGE, write the new message as a standalone search question (resolve "it", "he", "that chapter"… from
the conversation), then that question in each of these languages: {languages}.{title}
Reply with one JSON object and nothing else: {{"question": string, "translations": {{{shape}}}{title_key}}}"""


def _history(messages: list[Message]) -> list[Message]:
    """The last turns, newest kept whole, within the character budget."""
    kept, size = [], 0
    for m in reversed(messages[-HISTORY_TURNS:]):
        size += len(m.content)
        if kept and size > HISTORY_CHARS:
            break
        kept.append(m)
    return list(reversed(kept))


def _search_plan(db: Session, history: list[Message], content: str, scope: list[str] | None,
                 first: bool) -> tuple[str, list[str], str]:
    """(standalone question, its wordings for the books' languages, a title on the first turn)."""
    where = "AND b.id = ANY(:books)" if scope else ""
    languages = sorted(db.execute(text(f"""SELECT DISTINCT b.language FROM books b JOIN book_index i
                                            ON i.book_id = b.id WHERE TRUE {where}"""), {"books": scope or []}).scalars())
    names = ", ".join(f"{LANGUAGES.get(c, c)} ({c})" for c in languages) or "the question's language"
    prompt = REWRITE_PROMPT.format(
        languages=names, shape=", ".join(f'"{c}": string' for c in languages),
        title=("\nAlso give the conversation a short title of at most 6 words, written in the SAME language as the"
               " new message (a Spanish message gets a Spanish title)." if first else ""),
        title_key=', "title": string' if first else "")
    conversation = "\n".join(f"{m.role.upper()}: {m.content[:1500]}" for m in history) or "(none yet)"
    try:
        data, _model = groq_client.chat_json(prompt, f"CONVERSATION:\n{conversation}\n\nNEW MESSAGE: {content}",
                                             max_tokens=500)
    except groq_client.GroqError as e:
        logger.warning("Search not prepared, using the message as asked: %s", e)
        return content, [content], content[:60] if first else ""
    question = str(data.get("question") or content).strip()
    translations = data.get("translations") if isinstance(data.get("translations"), dict) else {}
    variants = list(dict.fromkeys([question, *(str(v).strip() for v in translations.values() if str(v).strip())]))
    title = str(data.get("title") or "").strip()[:120] if first else ""
    return question, variants, title or (content[:60] if first else "")


CHAT_PROMPT = f"""You are the reader's companion for their own library of books, in an ongoing conversation.
{CITATION_RULES}
Write plain text with light Markdown (short paragraphs, "- " lists, **bold** for key terms). Source numbers
refer to the SOURCES of the newest question only.

LIBRARY:
{{library}}"""


def _event(name: str, data) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post("/{conversation_id}/messages")
def send(conversation_id: str, body: MessageIn, reader: Reader = Depends(get_current_reader),
         db: Session = Depends(get_db)):
    convo = _own(db, reader, conversation_id)
    earlier = _messages(db, conversation_id)
    content = body.content.strip()
    user_id = db.execute(text("""INSERT INTO messages (conversation_id, role, content) VALUES (:c, 'user', :t)
                                 RETURNING id"""), {"c": conversation_id, "t": content}).scalar()
    db.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :id"), {"id": conversation_id})
    db.commit()

    history = _history(earlier)
    first = not earlier and not convo.title
    question, variants, title = _search_plan(db, history, content, convo.book_ids, first)
    scope = convo.book_ids or books_named(db, f"{content} {question}") or None
    passages = retrieve(db, question, scope, SOURCES, variants=variants)
    messages = [{"role": "system", "content": CHAT_PROMPT.format(library=library_overview(db))}]
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": f"SOURCES:\n{numbered_sources(passages)}\n\nQUESTION: {content}"})

    def stream() -> Iterator[str]:
        yield _event("sources", [p.model_dump() for p in passages])
        answer = []
        try:
            for piece in groq_client.chat_stream(messages, max_tokens=1500):
                answer.append(piece)
                yield _event("delta", piece)
        except groq_client.GroqError as e:
            yield _event("error", {"message": str(e), "user_message_id": user_id})
            return
        text_ = "".join(answer).strip()
        # the request's session is closed by the time a streamed body runs: use a connection of our own
        with get_engine().begin() as conn:
            assistant_id = conn.execute(text("""INSERT INTO messages (conversation_id, role, content, sources)
                                                VALUES (:c, 'assistant', :t, CAST(:s AS jsonb)) RETURNING id"""),
                                        {"c": conversation_id, "t": text_,
                                         "s": json.dumps([p.model_dump() for p in passages], ensure_ascii=False)}).scalar()
            if title:
                conn.execute(text("UPDATE conversations SET title = :t WHERE id = :id AND title = ''"),
                             {"t": title, "id": conversation_id})
            conn.execute(text("UPDATE conversations SET updated_at = now() WHERE id = :id"), {"id": conversation_id})
        yield _event("done", {"user_message_id": user_id, "assistant_message_id": assistant_id,
                              "title": title or convo.title})

    # no-transform: keep proxies from buffering or compressing the stream
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
