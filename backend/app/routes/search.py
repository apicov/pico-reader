"""Searching the library and asking it questions (RAG): the passages come from app/search_service.py; /ask lets the
AI answer from those passages only, citing them. Also where the desktop tool writes a book's index."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import categories, llm
from app import library_service as books
from app.auth import Reader, get_current_admin, get_current_reader
from app.db import get_db
from app.search_service import CITATION_RULES, Passage, books_named, library_overview, numbered_sources, retrieve
from pico_core import embed

router = APIRouter(prefix="/api", tags=["search"])

class IndexStart(BaseModel):
    format: str
    sha256: str
    model: str
    word_count: int | None = None  # words in the book's text, for reading statistics


class Chunk(BaseModel):
    seq: int
    location: str = ""
    progress: float = Field(ge=0, le=1)
    heading: str = ""
    text: str = Field(min_length=1)
    embedding: list[float] = Field(min_length=embed.DIMENSIONS, max_length=embed.DIMENSIONS)


@router.post("/admin/books/{book_id}/index/start")
def index_start(book_id: str, body: IndexStart, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Drop the book's old passages; chunks follow in batches, then /finish."""
    if body.model != embed.MODEL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The server searches with {embed.MODEL}")
    if db.execute(text("SELECT 1 FROM books WHERE id = :id"), {"id": book_id}).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such book")
    books.start_index(db, book_id, body.format, body.sha256, body.model, body.word_count)
    db.commit()
    return {"ok": True}


@router.post("/admin/books/{book_id}/index/chunks")
def index_chunks(book_id: str, chunks: list[Chunk], _: Reader = Depends(get_current_admin),
                 db: Session = Depends(get_db)):
    books.add_chunks(db, book_id, [c.model_dump() for c in chunks])
    db.commit()
    return {"added": len(chunks)}


@router.post("/admin/books/{book_id}/index/finish")
def index_finish(book_id: str, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    """After the last chunks: write the offline search file and note it in the history."""
    entry = books.write_search_file(db, book_id)
    title = db.execute(text("SELECT title FROM books WHERE id = :id"), {"id": book_id}).scalar() or ""
    books.record(db, book_id, title, "indexed", admin.email, {"by": "desktop tool"})
    db.commit()
    categories.classify_quietly(db, book_id)
    return {"search_file": bool(entry)}


# --- searching ---

@router.get("/search", response_model=list[Passage])
def search(q: str, book_id: list[str] | None = Query(default=None), limit: int = Query(10, ge=1, le=30),
           reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if not q.strip():
        return []
    return retrieve(db, q.strip()[:500], book_id, limit, who=(reader.email, "search"))


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    book_ids: list[str] | None = None


class Answer(BaseModel):
    answer: str
    sources: list[Passage]  # numbered from 1, as cited in the answer


ASK_PROMPT = f"""You answer questions about the reader's own books.
{CITATION_RULES}
Reply with one JSON object and nothing else: {{"answer": string with the citations, "used": [numbers cited]}}"""


@router.post("/ask", response_model=Answer)
def ask(body: AskRequest, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    scope = body.book_ids or books_named(db, body.question) or None
    passages = retrieve(db, body.question, scope, 8, who=(reader.email, "search"))
    user = (f"LIBRARY:\n{library_overview(db)}\n\nSOURCES:\n{numbered_sources(passages)}"
            f"\n\nQUESTION: {body.question}")
    data, _model = llm.chat_json(ASK_PROMPT, user, max_tokens=1200, who=(reader.email, "ask"))
    answer = str(data.get("answer") or "").strip()
    if not answer:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The model returned no answer")
    return Answer(answer=answer, sources=passages)
