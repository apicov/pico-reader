"""Searching the library and asking it questions (RAG).

Books are cut into passages and embedded on the desktop (tools/ `reader index`); the server embeds the
question with the same model and combines nearest passages (pgvector) with plain word matches (Postgres full
text), so a question finds both what it means and the exact words it uses. /ask then lets Groq answer from
those passages only, citing them.
"""

import logging
from functools import lru_cache

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
    word_count: int | None = None  # words in the book's text, for reading statistics


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
    if body.word_count:
        db.execute(text("UPDATE books SET word_count = :n WHERE id = :id"), {"n": body.word_count, "id": book_id})
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


QUERY_PROMPT = """Translate the search QUERY into each of these languages: {languages}. Keep each one a short search
query with the same meaning (don't answer it, don't add words). Reply with one JSON object and nothing else:
{{"detected_language": ISO 639-1 code of the query, "translations": {{{shape}}}}}"""


@lru_cache(maxsize=256)
def _translated(query: str, languages: tuple[str, ...], who: groq_client.Who = None) -> tuple[str, ...]:
    """The query in the books' languages. The small embedding model matches best within one language, and
    word search only finds the book's own words, so a Spanish question about a German book needs German too."""
    from app.routes.translate import LANGUAGES

    names = ", ".join(f"{LANGUAGES.get(code, code)} ({code})" for code in languages)
    shape = ", ".join(f'"{code}": string' for code in languages)
    data, _model = groq_client.chat_json(QUERY_PROMPT.format(languages=names, shape=shape), f"QUERY: {query}",
                                         max_tokens=400, who=who)
    translations = data.get("translations") or {}
    return tuple(str(translations[c]).strip() for c in languages
                 if isinstance(translations, dict) and str(translations.get(c) or "").strip())


def query_variants(db: Session, query: str, book_ids: list[str] | None, who: groq_client.Who = None) -> list[str]:
    scope = "AND b.id = ANY(:books)" if book_ids else ""
    languages = tuple(sorted(db.execute(text(f"""SELECT DISTINCT b.language FROM books b
                                                JOIN book_index i ON i.book_id = b.id WHERE TRUE {scope}"""),
                                        {"books": book_ids or []}).scalars()))
    variants = [query]
    if languages:
        try:
            variants += [v for v in _translated(query, languages, who) if v.lower() != query.lower()]
        except groq_client.GroqError as e:
            logger.warning("Query not translated, searching as asked: %s", e)
    return list(dict.fromkeys(variants))  # unique, in order


def _plain(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def books_named(db: Session, question: str) -> list[str]:
    """Ids of the indexed books whose title the question names ("…in Die Wolke?"): searching only them keeps
    another book's passages from crowding out the one asked about."""
    asked = _plain(question)
    rows = db.execute(text("SELECT b.id, b.title FROM books b JOIN book_index i ON i.book_id = b.id")).fetchall()
    return [r.id for r in rows if len(r.title) >= 4 and _plain(r.title) in asked]


def library_overview(db: Session) -> str:
    """Every book in the library, for questions about the library itself ("how many books do I have?")."""
    rows = db.execute(text("""SELECT b.title, b.author, b.language, b.files, i.chunks FROM books b
                              LEFT JOIN book_index i ON i.book_id = b.id WHERE b.status = 'ready'
                              ORDER BY lower(b.title)""")).fetchall()
    from app.routes.translate import LANGUAGES

    lines = [f"The reader's library has {len(rows)} book{'s' if len(rows) != 1 else ''}:"]
    for r in rows:
        formats = ", ".join(sorted(k for k in r.files if k != "cover"))
        searchable = "searchable" if r.chunks else "not indexed for search yet"
        author = f" by {r.author}" if r.author else ""
        lines.append(f"- {r.title}{author} ({LANGUAGES.get(r.language, r.language)}; {formats}; {searchable})")
    return "\n".join(lines)


def retrieve(db: Session, query: str, book_ids: list[str] | None, limit: int,
             variants: list[str] | None = None, who: groq_client.Who = None) -> list[Passage]:
    """The best passages for `query` (and its `variants`, the same question worded for the books' languages)."""
    variants = variants or query_variants(db, query, book_ids, who)
    vectors = embed.embed(variants, "query")
    scope = "AND c.book_id = ANY(:books)" if book_ids else ""
    rankings = []
    for variant, vector in zip(variants, vectors):
        params = {"v": _vector(vector.tolist()), "q": variant, "n": CANDIDATES, "books": book_ids or []}
        rankings.append(db.execute(text(f"""SELECT c.id FROM book_chunks c WHERE TRUE {scope}
                                            ORDER BY c.embedding <=> CAST(:v AS vector) LIMIT :n"""),
                                   params).scalars().all())
        rankings.append(db.execute(text(f"""SELECT c.id FROM book_chunks c, websearch_to_tsquery('simple', :q) q
                                            WHERE c.tsv @@ q {scope} ORDER BY ts_rank_cd(c.tsv, q) DESC LIMIT :n"""),
                                   params).scalars().all())
    scores: dict[int, float] = {}
    for ranking in rankings:
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
def search(q: str, book_id: list[str] | None = Query(default=None), limit: int = 10,
           reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if not q.strip():
        return []
    return retrieve(db, q.strip()[:500], book_id, min(limit, 30), who=(reader.email, "search"))


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    book_ids: list[str] | None = None


class Answer(BaseModel):
    answer: str
    sources: list[Passage]  # numbered from 1, as cited in the answer


CITATION_RULES = """Answer in the language of the question, clearly and concisely: a few sentences, or a short list
when that is clearer. Use only the SOURCES (passages from the reader's books) and the LIBRARY list; never invent
facts. If they don't answer the question, say so briefly and mention what they do cover.
CITATIONS ARE REQUIRED for anything taken from the sources: end each such sentence with the number(s) of the
source(s) in square brackets, like "…evacuated [2]." or "…in 8 bits [1][3]". Facts from the LIBRARY list
(titles, number of books, languages) need no citation."""

ASK_PROMPT = f"""You answer questions about the reader's own books.
{CITATION_RULES}
Reply with one JSON object and nothing else: {{"answer": string with the citations, "used": [numbers cited]}}"""


def numbered_sources(passages: list[Passage]) -> str:
    return "\n\n".join(f"[{i}] {p.title} — {p.heading}\n{p.text}" for i, p in enumerate(passages, 1)) or "(none found)"


@router.post("/ask", response_model=Answer)
def ask(body: AskRequest, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    scope = body.book_ids or books_named(db, body.question) or None
    passages = retrieve(db, body.question, scope, 8, who=(reader.email, "search"))
    user = (f"LIBRARY:\n{library_overview(db)}\n\nSOURCES:\n{numbered_sources(passages)}"
            f"\n\nQUESTION: {body.question}")
    try:
        data, _model = groq_client.chat_json(ASK_PROMPT, user, max_tokens=1200, who=(reader.email, "ask"))
    except groq_client.GroqError as e:
        raise HTTPException(e.status, str(e))
    answer = str(data.get("answer") or "").strip()
    if not answer:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The model returned no answer")
    return Answer(answer=answer, sources=passages)
