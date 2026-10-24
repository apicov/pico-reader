import sqlite3
import zipfile
from io import BytesIO

from tests.test_translate import BODY, groq  # noqa: F401 (fixture)


def test_no_vocabulary_yet(client, auth_headers):
    assert client.get("/api/vocabulary.apkg", headers=auth_headers).status_code == 404


def test_apkg_has_one_card_per_term(client, auth_headers, groq):
    _, replies = groq
    replies.append({"translation": "Arrancó.", "notes": "", "vocabulary": [
        {"term": "anfahren", "meaning": "arrancar"}, {"term": "der Wagen", "meaning": "el coche"}]})
    replies.append({"translation": "El coche frenó.", "notes": "", "vocabulary": [
        {"term": "der Wagen", "meaning": "el coche"}, {"term": "bremsen", "meaning": "frenar"}]})
    client.post("/api/translate", headers=auth_headers, json={**BODY, "text": "Er fuhr an."})
    client.post("/api/translate", headers=auth_headers, json={**BODY, "text": "Der Wagen bremste."})
    r = client.get("/api/vocabulary.apkg", headers=auth_headers)
    assert r.status_code == 200
    with zipfile.ZipFile(BytesIO(r.content)) as z:
        db = BytesIO(z.read("collection.anki2"))
    path = "/tmp/pico-reader-test-collection.anki2"
    open(path, "wb").write(db.getvalue())
    notes = sqlite3.connect(path).execute("SELECT flds FROM notes").fetchall()
    terms = sorted(n[0].split("\x1f")[0] for n in notes)
    assert terms == ["anfahren", "bremsen", "der Wagen"]  # der Wagen only once
    wagen = next(n[0] for n in notes if n[0].startswith("der Wagen")).split("\x1f")
    assert "<b>Wagen</b>" in wagen[2]  # the example sentence marks the word


def test_tsv(client, auth_headers, groq):
    client.post("/api/translate", headers=auth_headers, json=BODY)
    lines = client.get("/api/vocabulary.tsv", headers=auth_headers).text.strip().split("\n")
    assert lines[0].startswith("language\tterm") and lines[1].startswith("de\teinreden\t")
