"""The vocabulary of saved translations as an Anki deck (.apkg) or a tab-separated file.

One card per word or phrase (the terms the model picked out of each translated passage), one deck per book
language. Notes have stable ids, so importing a newer export updates cards instead of duplicating them."""

import csv
import html
import io
import re
import tempfile
from pathlib import Path

import genanki
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db
from app.routes.translate import LANGUAGES

router = APIRouter(prefix="/api", tags=["vocabulary"])

# Fixed ids: Anki recognises the note type and decks again on the next import
MODEL_ID = 1_729_420_001
DECK_BASE_ID = 1_729_421_000

CARD_CSS = """.card { font-family: Georgia, serif; font-size: 22px; text-align: center; color: #2b2b2b; background: #faf8f3; }
.example { font-size: 17px; color: #555; margin-top: 18px; line-height: 1.5; }
.meaning { font-size: 22px; margin: 12px 0; }
.translation { font-size: 16px; color: #3d5a80; line-height: 1.5; }
.source { font-size: 12px; color: #999; margin-top: 16px; }
.nightMode .card, .card.nightMode { color: #d6d3cd; background: #1e1e1e; }"""

MODEL = genanki.Model(
    MODEL_ID, "Pico Reader vocabulary",
    fields=[{"name": "Term"}, {"name": "Meaning"}, {"name": "Example"}, {"name": "Translation"}, {"name": "Source"}],
    templates=[{
        "name": "Recognise",
        "qfmt": '{{Term}}<div class="example">{{Example}}</div>',
        "afmt": '{{FrontSide}}<hr id="answer"><div class="meaning">{{Meaning}}</div>'
                '<div class="translation">{{Translation}}</div><div class="source">{{Source}}</div>',
    }],
    css=CARD_CSS,
)


def _items(db: Session, reader: Reader, book_id: str | None):
    """(source_lang, term, meaning, example sentence, its translation, book title), newest translation first,
    each term once per language."""
    rows = db.execute(text("""
        SELECT t.source_lang, t.source_text, t.result, coalesce(b.title, t.book_id, '') AS title
        FROM translations t LEFT JOIN books b ON b.id = t.book_id
        WHERE t.reader_email = :e AND (CAST(:b AS text) IS NULL OR t.book_id = :b)
        ORDER BY t.id DESC"""), {"e": reader.email, "b": book_id})
    seen = set()
    for r in rows:
        for v in r.result.get("vocabulary", []):
            term, meaning = v.get("term", "").strip(), v.get("meaning", "").strip()
            key = (r.source_lang, term.lower())
            if term and meaning and key not in seen:
                seen.add(key)
                yield r.source_lang, term, meaning, r.source_text, r.result.get("translation", ""), r.title


def _highlight(sentence: str, term: str) -> str:
    """The sentence with the term in bold (its last word, so "der Wagen" marks "Wagen" too)."""
    escaped = html.escape(sentence)
    word = term.split()[-1]
    return re.sub(rf"({re.escape(html.escape(word))}\w*)", r"<b>\1</b>", escaped, count=1, flags=re.IGNORECASE)


@router.get("/vocabulary.apkg")
def vocabulary_apkg(book_id: str | None = None, reader: Reader = Depends(get_current_reader),
                    db: Session = Depends(get_db)):
    decks: dict[str, genanki.Deck] = {}
    for lang, term, meaning, example, translation, title in _items(db, reader, book_id):
        if lang not in decks:
            name = LANGUAGES.get(lang, lang or "Other")
            decks[lang] = genanki.Deck(DECK_BASE_ID + sum(map(ord, lang or "xx")), f"Pico Reader::{name}")
        decks[lang].add_note(genanki.Note(
            model=MODEL, guid=genanki.guid_for("pico-reader", lang, term.lower()),
            fields=[html.escape(term), html.escape(meaning), _highlight(example, term), html.escape(translation),
                    html.escape(title)]))
    if not decks:
        raise HTTPException(404, "No vocabulary yet: translate some passages first")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "vocabulary.apkg"
        genanki.Package(list(decks.values())).write_to_file(path)
        data = path.read_bytes()
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": 'attachment; filename="pico-reader-vocabulary.apkg"'})


@router.get("/vocabulary.tsv")
def vocabulary_tsv(book_id: str | None = None, reader: Reader = Depends(get_current_reader),
                   db: Session = Depends(get_db)):
    out = io.StringIO()
    writer = csv.writer(out, delimiter="\t", lineterminator="\n")
    writer.writerow(["language", "term", "meaning", "example", "translation", "book"])
    for item in _items(db, reader, book_id):
        writer.writerow(item)
    return Response(out.getvalue(), media_type="text/tab-separated-values; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="pico-reader-vocabulary.tsv"'})
