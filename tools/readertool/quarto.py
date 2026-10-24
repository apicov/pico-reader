"""A Quarto book → reflow bundle (zip) the app reads.

Quarto renders a book project only to HTML/PDF/EPUB (not to Markdown), and its HTML keeps what matters:
numbered sections and figures, cross-references, callouts, highlighted code, math as TeX for KaTeX. So the
book is rendered to HTML in a scratch copy (the source folder is never written to), and each chapter's
<main> content goes into the bundle with the images it uses. Layout: see tools/README.md.
"""

import json
import os
import platform
import posixpath
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import yaml
from bs4 import BeautifulSoup

from readertool.client import ToolError

# Page furniture that isn't book content
_DROP = ["script", "nav.page-navigation", "a.anchorjs-link", "button.code-copy-button", "div.quarto-title-meta",
         "#quarto-margin-sidebar", "nav.quarto-page-breadcrumbs", "div.quarto-alternate-formats", "div.quarto-other-links"]


def chapter_list(config: dict) -> list[dict]:
    """[{qmd, part}] in reading order, from _quarto.yml book.chapters and book.appendices."""
    book = config.get("book", {})
    out: list[dict] = []

    def walk(items, part):
        for item in items or []:
            if isinstance(item, str):
                out.append({"qmd": item, "part": part})
            elif isinstance(item, dict) and "chapters" in item:
                walk(item["chapters"], item.get("part", part))
            elif isinstance(item, dict) and "href" in item:
                out.append({"qmd": item["href"], "part": part})

    walk(book.get("chapters"), "")
    walk(book.get("appendices"), "Appendices")
    return out


def render(source: Path, workdir: Path) -> Path:
    """Render `source` to HTML in a copy inside `workdir`; returns the output folder."""
    copy = workdir / "book"
    shutil.copytree(source, copy, ignore=shutil.ignore_patterns("_book", ".quarto"))
    print("  rendering with quarto (HTML)…")
    result = subprocess.run(["quarto", "render", "--to", "html"], cwd=copy, capture_output=True, text=True)
    if result.returncode != 0:
        raise ToolError("quarto render failed:\n" + result.stderr[-2000:])
    config = yaml.safe_load((copy / "_quarto.yml").read_text())
    return copy / config.get("project", {}).get("output-dir", "_book")


def _sass() -> str | None:
    """The dart-sass that ships with Quarto (quarto/bin/tools/<arch>/dart-sass/sass)."""
    quarto = shutil.which("quarto")
    if not quarto:
        return None
    tools = Path(os.path.realpath(quarto)).parent / "tools"
    for arch in (platform.machine(), "x86_64", "aarch64"):
        candidate = tools / arch / "dart-sass" / "sass"
        if candidate.exists():
            return str(candidate)
    return None


def _theme_files(source: Path, config: dict) -> tuple[list[Path], list[Path]]:
    """The book's own .scss files of the HTML theme: (light, dark-only)."""
    theme = (config.get("format", {}).get("html") or {}).get("theme")
    pick = lambda names: [source / n for n in ([names] if isinstance(names, str) else names or [])
                          if str(n).endswith(".scss") and (source / n).exists()]
    if isinstance(theme, dict):
        light = pick(theme.get("light"))
        return light, [f for f in pick(theme.get("dark")) if f not in light]
    return pick(theme), []


def book_css(source: Path, config: dict) -> dict[str, str]:
    """The book's custom styles compiled to plain CSS: {"book.css": …, "book-dark.css": …}. Quarto's
    own bootstrap theme is left out (the app has its own reading styles), and so are remote @imports
    (the app bundles its fonts)."""
    sass = _sass()
    light, dark = _theme_files(source, config)
    if not sass or not light:
        return {}
    split = lambda f: (f.read_text().split("/*-- scss:rules --*/") + [""])[:2]
    parts = {f: split(f) for f in light + dark}
    defaults = "\n".join(parts[f][0] for f in light)
    out = {}
    for name, files, extra_defaults in (("book.css", light, ""),
                                         ("book-dark.css", dark, "\n".join(parts[f][0] for f in dark))):
        if not files:
            continue
        rules = "\n".join(parts[f][1] for f in files)
        rules = re.sub(r"@import\s+url\([^)]*\)\s*;", "", rules)
        result = subprocess.run([sass, "--stdin", "--no-source-map"], input=defaults + extra_defaults + rules,
                                capture_output=True, text=True)
        if result.returncode == 0:
            out[name] = result.stdout
        else:
            print(f"  warning: the book's styles didn't compile, left out: {result.stderr[:300]}")
    return out


def build_bundle(source: Path, out_zip: Path, language: str) -> dict:
    """Render and package the book; returns {title, author, chapters}."""
    config = yaml.safe_load((source / "_quarto.yml").read_text())
    if config.get("project", {}).get("type") != "book":
        raise ToolError(f"{source} is not a Quarto book project")
    book = config["book"]
    with tempfile.TemporaryDirectory() as tmp:
        site = render(source, Path(tmp))
        chapters, assets = [], set()
        for entry in chapter_list(config):
            html_path = posixpath.splitext(entry["qmd"])[0] + ".html"
            page = site / html_path
            if not page.exists():
                raise ToolError(f"Quarto produced no {html_path}")
            fragment, title, used = _chapter(page.read_text(encoding="utf-8"), html_path)
            chapters.append({"file": html_path, "title": title, "part": entry["part"], "html": fragment})
            assets |= used
        with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
            meta = {"format": 1, "title": book.get("title", ""), "subtitle": book.get("subtitle", ""),
                    "author": book.get("author", ""), "language": language,
                    "chapters": [{k: c[k] for k in ("file", "title", "part")} for c in chapters]}
            styles = book_css(source, config)
            meta["styles"] = sorted(styles)
            z.writestr("book.json", json.dumps(meta, ensure_ascii=False, indent=1))
            for name, css in styles.items():
                z.writestr(name, css)
            for c in chapters:
                z.writestr(c["file"], c["html"])
            for asset in sorted(assets):
                if (site / asset).is_file():
                    # images are already compressed
                    z.write(site / asset, asset, compress_type=zipfile.ZIP_STORED)
                else:
                    print(f"  warning: missing {asset}")
        return {"title": meta["title"], "author": meta["author"], "chapters": len(chapters), "images": len(assets)}


def _chapter(html: str, path: str) -> tuple[str, str, set[str]]:
    """The <main> content of one rendered page, its title, and the local files it references."""
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main", id="quarto-document-content") or soup.body
    for selector in _DROP:
        for el in main.select(selector):
            el.decompose()
    h1 = main.find("h1")
    title = " ".join(h1.get_text(" ", strip=True).split()) if h1 else posixpath.basename(path)
    used = set()
    base = posixpath.dirname(path)
    for el in main.find_all(["img", "source", "video", "audio"]):
        src = el.get("src", "")
        if src and not src.startswith(("data:", "http:", "https:", "//")):
            used.add(posixpath.normpath(posixpath.join(base, src)))
    return main.decode_contents(), title, used
