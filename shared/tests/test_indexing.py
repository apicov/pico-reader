import json
import zipfile

import numpy as np

from pico_core import embed, indexing


def reflow_book(path, chapters):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("book.json", json.dumps({"chapters": [{"file": f"c{i}.html", "title": t} for i, (t, _) in enumerate(chapters)]}))
        for i, (_, html) in enumerate(chapters):
            z.writestr(f"c{i}.html", html)


def test_a_reflow_book_becomes_index_rows_with_places(tmp_path, monkeypatch):
    monkeypatch.setattr(embed, "embed", lambda texts, kind="passage", batch=32: np.ones((len(texts), embed.DIMENSIONS)))
    book = tmp_path / "book.reflow"
    reflow_book(book, [("Eins", "<h1>Anfang</h1><p>Es war einmal ein Haus.</p>"), ("Zwei", "<p>Und dann kam der Regen.</p>")])
    found = indexing.read_passages(book, "reflow")
    # a passage starts after its heading, and is found under it; a chapter without one is under the chapter's title
    assert [(p.location, p.heading) for p in found] == [("c0:0.2258", "Anfang"), ("c1:0.0000", "Zwei")]
    assert indexing.word_count(found) == 10  # the passages' text, not the headings
    batches = list(indexing.index_rows(found, batch=1))
    assert [[r["seq"] for r in rows] for rows in batches] == [[0], [1]]
    assert batches[1][0]["progress"] == 0.5 and batches[0][0]["embedding"].shape == (embed.DIMENSIONS,)
