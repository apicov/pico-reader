"""Translating selected passages with Groq. Every translation is kept (per reader) for reading back and for
later analysis; asking again for the same passage with the same settings returns the stored one."""

import hashlib
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import groq_client
from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["translate"])

# Bump when the prompt changes: cached translations of an older prompt are then made again
PROMPT_VERSION = 1

LANGUAGES = {"de": "German", "en": "English", "es": "Spanish", "fr": "French", "it": "Italian",
             "pt": "Portuguese", "nl": "Dutch", "ru": "Russian", "el": "Greek", "la": "Latin"}


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    context: str = Field(default="", max_length=3000)
    source_lang: str = Field(default="", pattern=r"^([a-z]{2,3})?$")  # empty: detect
    target_lang: str = Field(pattern=r"^[a-z]{2,3}$")
    book_id: str | None = None
    location: str = ""


class VocabularyItem(BaseModel):
    term: str
    meaning: str


class Translation(BaseModel):
    id: int
    book_id: str | None
    location: str
    source_text: str
    context: str
    source_lang: str
    target_lang: str
    translation: str
    notes: str
    vocabulary: list[VocabularyItem]
    model: str
    created_at: datetime
    cached: bool = False


def prompt(source_lang: str, target_lang: str) -> str:
    source = LANGUAGES.get(source_lang, source_lang) if source_lang else "the passage's language"
    target = LANGUAGES.get(target_lang, target_lang)
    return f"""You are a literary translator helping a reader who is learning {source}.
Translate the PASSAGE from {source} into {target}.
- Translate faithfully and naturally; keep the tone, register and style of the author; keep proper names.
- Use the CONTEXT (the text around the passage) only to understand the passage: pronouns, idioms, ambiguous
  words. Do not translate the context. If the passage is a fragment, translate just the fragment.
Reply with one JSON object and nothing else, with exactly these keys:
- "translation" (string): the passage in {target}.
- "notes" (string, in {target}): at most two short sentences on idioms, grammar or ambiguities that matter
  for understanding the passage; "" if there is nothing worth saying.
- "vocabulary" (array of objects with "term" and "meaning", both strings): up to six words or phrases from
  the passage worth learning, each in its dictionary form in {source} (German nouns with their article),
  with its meaning in this context in {target}. Leave out trivial words.
- "detected_language" (string): the ISO 639-1 code of the passage's language."""


def _cache_key(body: TranslateRequest, model: str) -> str:
    raw = json.dumps([body.text, body.context, body.source_lang, body.target_lang, model, PROMPT_VERSION])
    return hashlib.sha256(raw.encode()).hexdigest()


def _clean(data: dict) -> dict:
    """The model's JSON in the shape we store, tolerant of small slips (a list as a string, missing keys)."""
    vocabulary = data.get("vocabulary") or []
    if isinstance(vocabulary, str):
        try:
            vocabulary = json.loads(vocabulary)
        except json.JSONDecodeError:
            vocabulary = []
    items = [{"term": str(v.get("term", "")).strip(), "meaning": str(v.get("meaning", "")).strip()}
             for v in vocabulary if isinstance(v, dict) and v.get("term")][:8]
    translation = str(data.get("translation") or "").strip()
    if not translation:
        raise groq_client.GroqError("The model returned no translation")
    return {"translation": translation, "notes": str(data.get("notes") or "").strip(), "vocabulary": items,
            "detected_language": str(data.get("detected_language") or "").strip()[:3]}


_COLUMNS = "id, book_id, location, source_text, context, source_lang, target_lang, model, result, created_at"


def _row(r, cached: bool = False) -> Translation:
    return Translation(id=r.id, book_id=r.book_id, location=r.location, source_text=r.source_text, context=r.context,
                       source_lang=r.source_lang, target_lang=r.target_lang, model=r.model, created_at=r.created_at,
                       translation=r.result["translation"], notes=r.result.get("notes", ""),
                       vocabulary=r.result.get("vocabulary", []), cached=cached)


@router.post("/translate", response_model=Translation)
def translate(body: TranslateRequest, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    model = groq_client.model()
    key = _cache_key(body, model)
    stored = db.execute(text(f"SELECT {_COLUMNS} FROM translations WHERE reader_email = :e AND cache_key = :k "
                             "ORDER BY id DESC LIMIT 1"), {"e": reader.email, "k": key}).fetchone()
    if stored:
        return _row(stored, cached=True)
    user = f"CONTEXT:\n{body.context or body.text}\n\nPASSAGE:\n{body.text}"
    try:
        data, model = groq_client.chat_json(prompt(body.source_lang, body.target_lang), user,
                                            who=(reader.email, "translate"))
        result = _clean(data)
    except groq_client.GroqError as e:
        raise HTTPException(e.status, str(e))
    row = db.execute(text(f"""
        INSERT INTO translations (reader_email, book_id, location, source_text, context, source_lang, target_lang,
                                  model, prompt_version, cache_key, result)
        VALUES (:e, :b, :l, :t, :c, :s, :tl, :m, :pv, :k, CAST(:r AS jsonb))
        RETURNING {_COLUMNS}
    """), {"e": reader.email, "b": body.book_id, "l": body.location, "t": body.text, "c": body.context,
           "s": body.source_lang or result["detected_language"], "tl": body.target_lang, "m": model,
           "pv": PROMPT_VERSION, "k": key, "r": json.dumps(result, ensure_ascii=False)}).fetchone()
    db.commit()
    return _row(row)


@router.get("/translations", response_model=list[Translation])
def translations(book_id: str | None = None, since_id: int = 0, limit: int = 500,
                 reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Newest first; `since_id` returns only newer ones (the app syncs its offline copy with it)."""
    rows = db.execute(text(f"""SELECT {_COLUMNS} FROM translations WHERE reader_email = :e AND id > :since
                               AND (CAST(:b AS text) IS NULL OR book_id = :b) ORDER BY id DESC LIMIT :n"""),
                      {"e": reader.email, "since": since_id, "b": book_id, "n": min(limit, 2000)})
    return [_row(r) for r in rows]


@router.delete("/translations/{translation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_translation(translation_id: int, reader: Reader = Depends(get_current_reader),
                       db: Session = Depends(get_db)):
    if db.execute(text("DELETE FROM translations WHERE id = :id AND reader_email = :e"),
                  {"id": translation_id, "e": reader.email}).rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    db.commit()


# --- the dictionary fallback: a word no offline dictionary has ---

class DefineRequest(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    context: str = Field(default="", max_length=1500)
    language: str = Field(pattern=r"^[a-z]{2,3}$")
    target_lang: str = Field(pattern=r"^[a-z]{2,3}$")


class Definition(BaseModel):
    word: str
    lemma: str
    part_of_speech: str
    meaning: str
    notes: str


def define_prompt(language: str, target: str) -> str:
    source, goal = LANGUAGES.get(language, language), LANGUAGES.get(target, target)
    return f"""You are a {source}–{goal} dictionary for a reader learning {source}. The WORD was not in their
dictionaries: it may be inflected, compound, rare, regional, old or a name. Using the SENTENCE it appears in:
- "lemma": its dictionary form in {source} (German nouns with their article);
- "part_of_speech": in {goal}, short (e.g. "sustantivo", "verbo");
- "meaning": its meaning in this sentence, in {goal}, short like a dictionary entry (alternatives separated by ";");
- "notes": in {goal}, one short sentence on the form (e.g. "participio de …", "compuesto de … + …"), or "".
Reply with one JSON object and nothing else with exactly those four keys."""


@router.post("/define", response_model=Definition)
def define(body: DefineRequest, reader: Reader = Depends(get_current_reader)):
    try:
        data, _model = groq_client.chat_json(define_prompt(body.language, body.target_lang),
                                             f"WORD: {body.word}\nSENTENCE: {body.context or body.word}", max_tokens=300,
                                             who=(reader.email, "define"))
    except groq_client.GroqError as e:
        raise HTTPException(e.status, str(e))
    meaning = str(data.get("meaning") or "").strip()
    if not meaning:
        raise HTTPException(502, "The model returned no meaning")
    return Definition(word=body.word, lemma=str(data.get("lemma") or body.word).strip(),
                      part_of_speech=str(data.get("part_of_speech") or "").strip(), meaning=meaning,
                      notes=str(data.get("notes") or "").strip())
