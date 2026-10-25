"""Seeds the end-to-end environment (run by run.sh from backend/, with its settings in the environment): the fake
R2 bucket with CORS, a reader, and one EPUB book with a pure-blue cover, uploaded through the real API.

    python seed.py <api url> <s3 url>
"""

import hashlib
import io
import struct
import sys
import zipfile
import zlib

import boto3
import httpx

from app.auth import create_access_token
from app.db import get_engine
from sqlalchemy import text

API, S3 = sys.argv[1], sys.argv[2]
EMAIL = "reader@example.com"
TITLE = "Die Wolke (Probe)"

PARAGRAPHS = [
    "Der Alarm kam am Vormittag, als Janna-Berta noch in der Schule saß.",
    "Die Lehrerin las die Durchsage vor, und plötzlich war es ganz still in der Klasse.",
    "Draußen schien die Sonne, als wäre nichts geschehen, doch die Straßen füllten sich mit Autos.",
] * 12


def epub() -> bytes:
    chapter = lambda n, title: f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de"><head><title>{title}</title></head><body>
<h1>{title}</h1>{''.join(f'<p id="p{n}-{i}">{p}</p>' for i, p in enumerate(PARAGRAPHS))}</body></html>"""
    files = {
        "META-INF/container.xml": """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""",
        "OEBPS/content.opf": f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e-wolke</dc:identifier>
<dc:title>{TITLE}</dc:title><dc:language>de</dc:language><dc:creator>Test</dc:creator>
<meta property="dcterms:modified">2026-10-25T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>""",
        "OEBPS/nav.xhtml": """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Inhalt</title></head>
<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Kapitel 1</a></li><li><a href="c2.xhtml">Kapitel 2</a></li></ol></nav>
</body></html>""",
        "OEBPS/c1.xhtml": chapter(1, "Kapitel 1"),
        "OEBPS/c2.xhtml": chapter(2, "Kapitel 2"),
    }
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")  # first and stored, as EPUB requires
        for name, content in files.items():
            z.writestr(name, content, compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()


def blue_png(width=120, height=180) -> bytes:
    """A cover of pure blue (0, 0, 255): the night theme must turn it into no blue at all."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    row = b"\x00" + b"\x00\x00\xff" * width
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b""))


def main() -> None:
    s3 = boto3.client("s3", endpoint_url=S3, aws_access_key_id="e2e", aws_secret_access_key="e2e", region_name="us-east-1")
    s3.create_bucket(Bucket="e2e-library")
    s3.put_bucket_cors(Bucket="e2e-library", CORSConfiguration={"CORSRules": [
        {"AllowedOrigins": ["*"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"]}]})
    with get_engine().begin() as c:
        c.execute(text("INSERT INTO readers (email, name, is_admin) VALUES (:e, 'Reader', true)"), {"e": EMAIL})
    headers = {"Authorization": f"Bearer {create_access_token(EMAIL)}"}
    blobs = {"epub": (epub(), "application/epub+zip"), "cover": (blue_png(), "image/png")}
    files = {k: {"size": len(b), "sha256": hashlib.sha256(b).hexdigest(), "content_type": t} for k, (b, t) in blobs.items()}
    r = httpx.post(f"{API}/api/books", headers=headers, json={"title": TITLE, "author": "Test", "language": "de", "files": files})
    r.raise_for_status()
    book = r.json()
    for kind, url in book["uploads"].items():
        data, content_type = blobs[kind]
        httpx.put(url, content=data, headers={"Content-Type": content_type}).raise_for_status()
    httpx.post(f"{API}/api/books/{book['id']}/commit", headers=headers).raise_for_status()
    print(f"  seeded {EMAIL} and {book['id']}")


if __name__ == "__main__":
    main()
