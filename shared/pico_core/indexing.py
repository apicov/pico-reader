"""A book's file → the rows of its search index: passages with their places, embedded a batch at a time (the
model's memory stays small). The server's indexer stores the rows itself; `reader index` sends them to the API."""

from collections.abc import Iterator
from pathlib import Path

from pico_core import embed, passages


def read_passages(path: Path, fmt: str) -> list[passages.Passage]:
    """The book's passages; empty when it has no text (a scanned PDF)"""
    return passages.EXTRACTORS[fmt](path)


def word_count(found: list[passages.Passage]) -> int:
    return sum(len(p.text.split()) for p in found)


def index_rows(found: list[passages.Passage], batch: int) -> Iterator[list[dict]]:
    """The rows, `batch` at a time: seq, location, progress, heading, text and embedding (a numpy vector)."""
    for start in range(0, len(found), batch):
        part = found[start:start + batch]
        vectors = embed.embed([p.text for p in part])
        yield [{"seq": start + i, "location": p.location, "progress": round(p.progress, 5), "heading": p.heading,
                "text": p.text, "embedding": vectors[i]} for i, p in enumerate(part)]
