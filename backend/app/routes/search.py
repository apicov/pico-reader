"""Searching the library and asking it questions (RAG).

Books are cut into passages and embedded on the desktop (tools/ `reader index`); the server embeds the
question with the same model and combines nearest passages (pgvector) with plain word matches (Postgres full
text), so a question finds both what it means and the exact words it uses. /ask then lets Groq answer from
those passages only, citing them.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import embed, groq_client
from app.auth import Reader, get_current_admin, get_current_reader
from app.db import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["search"])

CANDIDATES = 30  # per method, before fusing
RRF_K = 60  # reciprocal-rank fusion constant


# --- indexing (desktop tool) ---

class IndexStart(BaseModel):
    format: str
    sha256: str
    model: str


class Chunk(BaseModel):
    seq: int
    location: str = ""
    progress: float = Field(ge=0, le=1)
    heading: str = ""
    text: str = Field(min_length=1)
    embedding: list[float] = Field(min_length=embed.DIMENSIONS, max_length=embed.DIMENSIONS)


def _vector(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in values) + "]"


@router.post("/admin/books/{book_id}/index/start")
def index_start(book_id: str, body: IndexStart, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Drop the book's old passages; chunks follow in batches."""
    if body.model != embed.MODEL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The server searches with {embed.MODEL}")
    if db.execute(text("SELECT 1 FROM books WHERE id = :id"), {"id": book_id}).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such book")
    db.execute(text("DELETE FROM book_chunks WHERE book_id = :id"), {"id": book_id})
    db.execute(text("""
        INSERT INTO book_index (book_id, format, sha256, model, chunks) VALUES (:id, :f, :s, :m, 0)
        ON CONFLICT (book_id) DO UPDATE SET format = EXCLUDED.format, sha256 = EXCLUDED.sha256,
            model = EXCLUDED.model, chunks = 0, indexed_at = now()
    """), {"id": book_id, "f": body.format, "s": body.sha256, "m": body.model})
    db.commit()
    return {"ok": True}


@router.post("/admin/books/{book_id}/index/chunks")
def index_chunks(book_id: str, chunks: list[Chunk], _: Reader = Depends(get_current_admin),
                 db: Session = Depends(get_db)):
    fmt = db.execute(text("SELECT format FROM book_index WHERE book_id = :id"), {"id": book_id}).scalar()
    if fmt is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the index first")
    db.execute(text("""
        INSERT INTO book_chunks (book_id, seq, format, location, progress, heading, text, embedding)
        VALUES (:b, :seq, :f, :loc, :p, :h, :t, CAST(:e AS vector))
    """), [{"b": book_id, "seq": c.seq, "f": fmt, "loc": c.location, "p": c.progress, "h": c.heading,
            "t": c.text, "e": _vector(c.embedding)} for c in chunks])
    db.execute(text("UPDATE book_index SET chunks = chunks + :n WHERE book_id = :id"), {"n": len(chunks), "id": book_id})
    db.commit()
    return {"added": len(chunks)}


# --- searching ---

class Passage(BaseModel):
    book_id: str
    title: str
    heading: str
    format: str
    location: str
    progress: float
    text: str
    score: float


def retrieve(db: Session, query: str, book_ids: list[str] | None, limit: int) -> list[Passage]:
    vector = _vector(embed.embed([query], "query")[0].tolist())
    scope = "AND c.book_id = ANY(:books)" if book_ids else ""
    params = {"v": vector, "q": query, "n": CANDIDATES, "books": book_ids or []}
    near = db.execute(text(f"""SELECT c.id FROM book_chunks c WHERE TRUE {scope}
                               ORDER BY c.embedding <=> CAST(:v AS vector) LIMIT :n"""), params).scalars().all()
    words = db.execute(text(f"""SELECT c.id FROM book_chunks c, websearch_to_tsquery('simple', :q) q
                                WHERE c.tsv @@ q {scope} ORDER BY ts_rank_cd(c.tsv, q) DESC LIMIT :n"""),
                       params).scalars().all()
    scores: dict[int, float] = {}
    for ranking in (near, words):
        for rank, chunk_id in enumerate(ranking):
            scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (RRF_K + rank + 1)
    best = sorted(scores, key=scores.get, reverse=True)[:limit]
    if not best:
        return []
    rows = {r.id: r for r in db.execute(text("""
        SELECT c.id, c.book_id, b.title, c.heading, c.format, c.location, c.progress, c.text
        FROM book_chunks c JOIN books b ON b.id = c.book_id WHERE c.id = ANY(:ids)"""), {"ids": best})}
    return [Passage(book_id=rows[i].book_id, title=rows[i].title, heading=rows[i].heading, format=rows[i].format,
                    location=rows[i].location, progress=rows[i].progress, text=rows[i].text, score=round(scores[i], 5))
            for i in best if i in rows]


@router.get("/search", response_model=list[Passage])
def search(q: str, book_id: list[str] | None = Query(default=None), limit: int = 10, _: Reader = Depends(get_current_reader),
           db: Session = Depends(get_db)):
    if not q.strip():
        return []
    return retrieve(db, q.strip()[:500], book_id, min(limit, 30))


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    book_ids: list[str] | None = None


class Answer(BaseModel):
    answer: str
    sources: list[Passage]  # numbered from 1, as cited in the answer


ASK_PROMPT = """You answer questions about the reader's own books, using only the numbered SOURCES (passages
from those books). Answer in the language of the question, clearly and concisely (a few sentences; a short
list when that is clearer). After each statement, cite the sources it comes from like [1] or [2][3]. If the
sources don't answer the question, say so briefly and mention what they do cover. Never invent facts.
Reply with one JSON object and nothing else: {"answer": string, "used": [numbers of the sources you cited]}"""


@router.post("/ask", response_model=Answer)
def ask(body: AskRequest, _: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    passages = retrieve(db, body.question, body.book_ids, 8)
    if not passages:
        return Answer(answer="", sources=[])
    sources = "\n\n".join(f"[{i}] {p.title} — {p.heading}\n{p.text}" for i, p in enumerate(passages, 1))
    try:
        data, _model = groq_client.chat_json(ASK_PROMPT, f"SOURCES:\n{sources}\n\nQUESTION: {body.question}",
                                             max_tokens=1200)
    except groq_client.GroqError as e:
        raise HTTPException(e.status, str(e))
    answer = str(data.get("answer") or "").strip()
    if not answer:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The model returned no answer")
    return Answer(answer=answer, sources=passages)
