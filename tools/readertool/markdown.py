"""Markdown (marker output, or any .md with images) → reflow bundle.

pandoc (the one bundled with Quarto, or a standalone one) turns the Markdown into HTML with math left as
TeX in <span class="math …">, the same shape as Quarto's output, so the app has a single HTML path.
The text is split into chapters at its top-level headings, or into even parts when it has none.
"""

import json
import posixpath
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup, Tag

from readertool.client import ToolError

PART_CHARS = 60_000  # chapter size when the text has no headings


def _pandoc() -> list[str]:
    if shutil.which("pandoc"):
        return ["pandoc"]
    if shutil.which("quarto"):
        return ["quarto", "pandoc"]
    raise ToolError("pandoc is needed (install Quarto or pandoc)")


def to_html(md_file: Path) -> str:
    result = subprocess.run(
        [*_pandoc(), "--from", "markdown+tex_math_dollars+raw_html", "--to", "html5", "--mathjax", "--wrap=none", str(md_file)],
        capture_output=True, text=True, cwd=md_file.parent)
    if result.returncode != 0:
        raise ToolError("pandoc failed:\n" + result.stderr[-1500:])
    return result.stdout


def split_chapters(html: str, fallback_title: str) -> list[tuple[str, str]]:
    """[(title, html)]: at <h1>s when there are two or more, else at <h2>s, else in parts of ~PART_CHARS."""
    soup = BeautifulSoup(html, "html.parser")
    nodes = [n for n in soup.contents if not (isinstance(n, str) and not n.strip())]
    for level in ("h1", "h2"):
        if sum(1 for n in nodes if isinstance(n, Tag) and n.name == level) >= 2:
            chapters: list[tuple[str, list]] = [("", [])]
            for n in nodes:
                if isinstance(n, Tag) and n.name == level:
                    chapters.append((" ".join(n.get_text(" ", strip=True).split()), [n]))
                else:
                    chapters[-1][1].append(n)
            if not "".join(str(x) for x in chapters[0][1]).strip():
                chapters.pop(0)
            elif not chapters[0][0]:
                chapters[0] = (fallback_title, chapters[0][1])
            return [(title or fallback_title, "".join(str(x) for x in body)) for title, body in chapters]
    parts, current, size = [], [], 0
    for n in nodes:
        current.append(str(n))
        size += len(str(n))
        if size >= PART_CHARS:
            parts.append(current)
            current, size = [], 0
    if current:
        parts.append(current)
    return [(f"{fallback_title} ({i + 1}/{len(parts)})" if len(parts) > 1 else fallback_title, "".join(p))
            for i, p in enumerate(parts)]


def build_bundle(md_file: Path, out_zip: Path, title: str, author: str, language: str) -> dict:
    html = to_html(md_file)
    chapters = split_chapters(html, title)
    images = set()
    for src in re.findall(r'<img[^>]+src="([^"]+)"', html):
        if not src.startswith(("data:", "http:", "https:", "//")):
            images.add(posixpath.normpath(src))
    # chapters sit next to the .md file in the bundle, so image paths stay as written
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        meta = {"format": 1, "title": title, "author": author, "language": language,
                "chapters": [{"file": f"ch{i:03d}.html", "title": t, "part": ""} for i, (t, _) in enumerate(chapters)]}
        z.writestr("book.json", json.dumps(meta, ensure_ascii=False, indent=1))
        for i, (_, body) in enumerate(chapters):
            z.writestr(f"ch{i:03d}.html", body)
        for rel in sorted(images):
            path = (md_file.parent / rel).resolve()
            if path.is_file() and md_file.parent.resolve() in path.parents:
                z.write(path, rel, compress_type=zipfile.ZIP_STORED)
            else:
                print(f"  warning: missing image {rel}")
    return {"chapters": len(chapters), "images": len(images)}


def marker_to_markdown(pdf: Path, workdir: Path) -> Path:
    """Run marker (https://github.com/datalab-to/marker) on a PDF; returns the Markdown file it wrote."""
    exe = shutil.which("marker_single")
    if not exe:
        raise ToolError("marker isn't installed (pip install marker-pdf), or pass --reflow-from <file.md>")
    print("  converting with marker (this can take a while)…")
    result = subprocess.run([exe, str(pdf), "--output_dir", str(workdir)], capture_output=True, text=True)
    if result.returncode != 0:
        raise ToolError("marker failed:\n" + result.stderr[-1500:])
    found = sorted(workdir.rglob("*.md"))
    if not found:
        raise ToolError("marker produced no Markdown")
    return found[0]
