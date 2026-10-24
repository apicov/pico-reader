"""Book text → passages of about a paragraph or three (~1000 characters), each with the place the reader opens
for it: reflow `c<chapter>:<fraction>`, EPUB a progress through the book (as foliate measures it: section
file sizes), PDF `p<page>:<fraction>`. Used by `reader index` for search."""

import posixpath
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

from bs4 import BeautifulSoup

TARGET = 1000  # characters per passage
LIMIT = 1600  # a longer paragraph is split at sentences
BLOCKS = ["h1", "h2", "h3", "h4", "p", "li", "pre", "blockquote", "figcaption", "dd", "dt", "td"]


@dataclass
class Passage:
    location: str
    progress: float
    heading: str
    text: str


def _paragraphs(html: str) -> list[tuple[str, str]]:
    """[(kind, text)] in reading order: kind "h" for headings, "p" for everything else."""
    soup = BeautifulSoup(html, "html.parser")
    for el in soup(["script", "style", "nav"]):
        el.decompose()
    out = []
    for el in soup.find_all(BLOCKS):
        if el.find_parent(BLOCKS):  # its text is in the outer block already
            continue
        text = " ".join(el.get_text(" ", strip=True).split())
        if text:
            out.append(("h" if el.name in ("h1", "h2", "h3", "h4") else "p", text))
    if not out:  # plain text without block elements
        text = " ".join(soup.get_text(" ", strip=True).split())
        if text:
            out.append(("p", text))
    return out


def _split_long(text: str) -> list[str]:
    if len(text) <= LIMIT:
        return [text]
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?…])\s+", text):
        if current and len(current) + len(sentence) > TARGET:
            parts.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        parts.append(current)
    return [p[i:i + LIMIT] for p in parts for i in range(0, len(p), LIMIT)]


def _chunks(paragraphs: list[tuple[str, str]], default_heading: str):
    """(start offset in characters, heading, text) of each passage of one section."""
    heading, offset, start, buffer = default_heading, 0, 0, []
    for kind, text in paragraphs:
        if kind == "h":
            if buffer:
                yield start, heading, " ".join(buffer)
                buffer = []
            heading = text[:200]
            offset += len(text) + 1
            start = offset
            continue
        for piece in _split_long(text):
            if not buffer:
                start = offset
            buffer.append(piece)
            offset += len(piece) + 1
            if sum(len(b) for b in buffer) >= TARGET:
                yield start, heading, " ".join(buffer)
                buffer = []
    if buffer:
        yield start, heading, " ".join(buffer)


def _total(paragraphs: list[tuple[str, str]]) -> int:
    return max(1, sum(len(t) + 1 for _, t in paragraphs))


def from_reflow(path: Path) -> list[Passage]:
    import json

    with zipfile.ZipFile(path) as z:
        meta = json.loads(z.read("book.json"))
        chapters = meta["chapters"]
        out = []
        for i, chapter in enumerate(chapters):
            paragraphs = _paragraphs(z.read(chapter["file"]).decode("utf-8"))
            total = _total(paragraphs)
            for start, heading, text in _chunks(paragraphs, chapter["title"]):
                fraction = min(1.0, start / total)
                out.append(Passage(f"c{i}:{fraction:.4f}", (i + fraction) / len(chapters), heading, text))
        return out


_NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container", "opf": "http://www.idpf.org/2007/opf"}


def from_epub(path: Path) -> list[Passage]:
    with zipfile.ZipFile(path) as z:
        container = ElementTree.fromstring(z.read("META-INF/container.xml"))
        opf_path = container.find(".//c:rootfile", _NS).get("full-path")
        opf = ElementTree.fromstring(z.read(opf_path))
        items = {i.get("id"): i.get("href") for i in opf.findall(".//opf:manifest/opf:item", _NS)}
        base = posixpath.dirname(opf_path)
        spine = [posixpath.normpath(posixpath.join(base, items[r.get("idref")]))
                 for r in opf.findall(".//opf:spine/opf:itemref", _NS)
                 if r.get("linear") != "no" and r.get("idref") in items]
        names = set(z.namelist())
        spine = [s for s in spine if s in names]
        sizes = [z.getinfo(s).file_size for s in spine]
        whole = max(1, sum(sizes))
        out, before = [], 0
        for index, (name, size) in enumerate(zip(spine, sizes)):
            paragraphs = _paragraphs(z.read(name).decode("utf-8", errors="replace"))
            total = _total(paragraphs)
            for start, heading, text in _chunks(paragraphs, ""):
                progress = (before + size * start / total) / whole
                out.append(Passage(f"s{index}:{start / total:.4f}", min(1.0, progress), heading, text))
            before += size
        return out


def from_pdf(path: Path) -> list[Passage]:
    import pymupdf

    out = []
    with pymupdf.open(path) as doc:
        pages = len(doc)
        for number, page in enumerate(doc, 1):
            height = page.rect.height or 1
            blocks = [b for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
            buffer, top = [], 0.0
            for x0, y0, x1, y1, text, *_ in blocks:
                if not buffer:
                    top = y0
                buffer.append(" ".join(text.split()))
                if sum(len(b) for b in buffer) >= TARGET:
                    fraction = min(1.0, top / height)
                    out.append(Passage(f"p{number}:{fraction:.4f}", (number - 1 + fraction) / pages, "", " ".join(buffer)))
                    buffer = []
            if buffer:
                fraction = min(1.0, top / height)
                out.append(Passage(f"p{number}:{fraction:.4f}", (number - 1 + fraction) / pages, "", " ".join(buffer)))
    return [p for p in out if len(p.text) > 40]


EXTRACTORS = {"reflow": from_reflow, "epub": from_epub, "pdf": from_pdf}
