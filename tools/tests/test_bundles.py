import json
import shutil
import zipfile

import pytest

from readertool import markdown, quarto


def test_quarto_chapter_order_with_parts_and_appendices():
    config = {"book": {"chapters": ["index.qmd", {"part": "Foundations", "chapters": ["a.qmd", "b.qmd"]}],
                       "appendices": ["x.qmd"]}}
    assert quarto.chapter_list(config) == [
        {"qmd": "index.qmd", "part": ""}, {"qmd": "a.qmd", "part": "Foundations"},
        {"qmd": "b.qmd", "part": "Foundations"}, {"qmd": "x.qmd", "part": "Appendices"}]


def test_quarto_chapter_keeps_content_drops_navigation():
    page = """<html><body><nav>site nav</nav><main id="quarto-document-content">
      <h1 class="title"><span class="chapter-number">5</span> Quantisierung</h1>
      <p>Größe <span class="math inline">r = S(q - Z)</span></p><img src="05_files/fig.png">
      <nav class="page-navigation">next</nav><script>x()</script></main></body></html>"""
    html, title, used = quarto._chapter(page, "chapters/05.html")
    assert title == "5 Quantisierung"
    assert "Größe" in html and "math inline" in html
    assert "page-navigation" not in html and "<script" not in html
    assert used == {"chapters/05_files/fig.png"}


def test_markdown_splits_at_headings():
    html = "<h1>Eins</h1><p>a</p><h1>Zwei</h1><p>b</p>"
    assert [t for t, _ in markdown.split_chapters(html, "Buch")] == ["Eins", "Zwei"]


def test_markdown_without_headings_is_split_into_parts(monkeypatch):
    monkeypatch.setattr(markdown, "PART_CHARS", 20)
    html = "".join(f"<p>Absatz {i} mit Text</p>" for i in range(6))
    parts = markdown.split_chapters(html, "Buch")
    assert len(parts) > 1 and parts[0][0].startswith("Buch (1/")


@pytest.mark.skipif(not (shutil.which("pandoc") or shutil.which("quarto")), reason="needs pandoc")
def test_markdown_bundle_keeps_math_as_tex_and_images(tmp_path):
    (tmp_path / "img").mkdir()
    (tmp_path / "img" / "a.png").write_bytes(b"\x89PNG")
    md = tmp_path / "book.md"
    md.write_text("# Eins\n\nDie Größe $E = mc^2$\n\n![x](img/a.png)\n\n# Zwei\n\nStraße\n", encoding="utf-8")
    out = tmp_path / "b.zip"
    assert markdown.build_bundle(md, out, "Buch", "A", "de") == {"chapters": 2, "images": 1}
    with zipfile.ZipFile(out) as z:
        assert json.loads(z.read("book.json"))["language"] == "de"
        first = z.read("ch000.html").decode()
        assert r'<span class="math inline">\(E = mc^2\)</span>' in first and "Größe" in first
        assert "img/a.png" in z.namelist()
