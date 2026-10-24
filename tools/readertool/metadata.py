"""Title, author, language and a cover image from PDF and EPUB files."""

import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pymupdf

COVER_WIDTH = 600


def pdf_metadata(path: Path) -> dict:
    with pymupdf.open(path) as doc:
        meta = doc.metadata or {}
        return {"title": (meta.get("title") or "").strip(), "author": (meta.get("author") or "").strip()}


def pdf_cover(path: Path, out: Path) -> Path:
    """The first page as a JPEG, COVER_WIDTH pixels wide."""
    with pymupdf.open(path) as doc:
        page = doc[0]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(COVER_WIDTH / page.rect.width, COVER_WIDTH / page.rect.width))
        pix.save(out, jpg_quality=85)
    return out


_NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container", "opf": "http://www.idpf.org/2007/opf",
       "dc": "http://purl.org/dc/elements/1.1/"}


def epub_metadata(path: Path, cover_out: Path) -> dict:
    """Title, author, language and (when the book declares one) the cover, written to `cover_out`."""
    with zipfile.ZipFile(path) as z:
        container = ElementTree.fromstring(z.read("META-INF/container.xml"))
        opf_path = container.find(".//c:rootfile", _NS).get("full-path")
        opf = ElementTree.fromstring(z.read(opf_path))
        text = lambda tag: (opf.findtext(f".//dc:{tag}", default="", namespaces=_NS) or "").strip()
        meta = {"title": text("title"), "author": text("creator"), "language": text("language")[:2].lower(),
                "cover": None}
        items = opf.findall(".//opf:manifest/opf:item", _NS)
        cover = next((i for i in items if "cover-image" in (i.get("properties") or "")), None)
        if cover is None:  # EPUB 2: <meta name="cover" content="<item id>"/>
            ref = opf.find(".//opf:metadata/opf:meta[@name='cover']", _NS)
            cover = next((i for i in items if ref is not None and i.get("id") == ref.get("content")), None)
        if cover is not None and (cover.get("media-type") or "").startswith("image/"):
            href = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), cover.get("href")))
            out = cover_out.with_suffix({"image/png": ".png", "image/webp": ".webp"}.get(cover.get("media-type"), ".jpg"))
            out.write_bytes(z.read(href))
            meta["cover"] = (out, cover.get("media-type") if cover.get("media-type") != "image/jpg" else "image/jpeg")
        return meta
