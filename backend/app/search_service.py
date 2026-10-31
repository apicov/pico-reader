"""Finding passages in the library for a question (search, /ask, the chat agent).

Books are cut into passages and embedded (the server's indexer, or `reader index` on a computer); a question is
embedded with the same model, and the nearest passages (pgvector) are combined with plain word matches (Postgres
full text), so a question finds both what it means and the exact words it uses."""

import logging
import unicodedata
from functools import lru_cache

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import groq_client
from app.languages import LANGUAGES
from app.library_service import vector_literal
from pico_core import embed

logger = logging.getLogger(__name__)

CANDIDATES = 30  # per method, before fusing
RRF_K = 60  # reciprocal-rank fusion constant


# --- indexing (desktop tool) ---

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


def fold_accents(s: str) -> str:
    """Lower case without accents, to match names however they're typed"""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def books_named(db: Session, question: str) -> list[str]:
    """Ids of the indexed books whose title the question names ("…in Die Wolke?"): searching only them keeps
    another book's passages from crowding out the one asked about."""
    asked = fold_accents(question)
    rows = db.execute(text("SELECT b.id, b.title FROM books b JOIN book_index i ON i.book_id = b.id")).fetchall()
    return [r.id for r in rows if len(r.title) >= 4 and fold_accents(r.title) in asked]


def library_overview(db: Session) -> str:
    """Every book in the library, for questions about the library itself ("how many books do I have?")."""
    rows = db.execute(text("""SELECT b.title, b.author, b.language, b.files, i.chunks FROM books b
                              LEFT JOIN book_index i ON i.book_id = b.id WHERE b.status = 'ready'
                              ORDER BY lower(b.title)""")).fetchall()
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
    for variant, vector in zip(variants, vectors, strict=True):
        params = {"v": vector_literal(vector), "q": variant, "n": CANDIDATES, "books": book_ids or []}
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


CITATION_RULES = """Answer in the language of the question, clearly and concisely: a few sentences, or a short list
when that is clearer. Use only the SOURCES (passages from the reader's books) and the LIBRARY list; never invent
facts. If they don't answer the question, say so briefly and mention what they do cover.
CITATIONS ARE REQUIRED for anything taken from the sources: end each such sentence with the number(s) of the
source(s) in square brackets, like "…evacuated [2]." or "…in 8 bits [1][3]". Facts from the LIBRARY list
(titles, number of books, languages) need no citation."""


def numbered_sources(passages: list[Passage]) -> str:
    return "\n\n".join(f"[{i}] {p.title} — {p.heading}\n{p.text}" for i, p in enumerate(passages, 1)) or "(none found)"
