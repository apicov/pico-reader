import json

import httpx
import pytest

from app import groq_client
from app.config import get_settings

GOOD = {"translation": "Janna-Berta vio cómo le hablaba a su marido.", "notes": "«einreden»: insistir.",
        "vocabulary": [{"term": "einreden", "meaning": "hablar con insistencia"}], "detected_language": "de"}


@pytest.fixture
def groq(monkeypatch):
    """A fake Groq: replies in turn with the queued contents (dicts become JSON); records the requests."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    calls, replies = [], []

    def post(url, json=None, headers=None, timeout=None):
        calls.append(json)
        reply = replies.pop(0) if replies else GOOD
        if isinstance(reply, httpx.Response):
            return reply
        content = reply if isinstance(reply, str) else __import__("json").dumps(reply)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "model": json["model"],
                                         "usage": {"prompt_tokens": 120, "completion_tokens": 30}})

    monkeypatch.setattr(groq_client.httpx, "post", post)
    yield calls, replies
    get_settings.cache_clear()


BODY = {"text": "Janna-Berta sah noch, wie sie auf ihren Mann einredete.", "context": "…", "source_lang": "de",
        "target_lang": "es", "book_id": "die-wolke", "location": "epubcfi(/6/8)"}


def test_translates_and_stores(client, auth_headers, groq):
    calls, _ = groq
    r = client.post("/api/translate", headers=auth_headers, json=BODY)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["translation"] == GOOD["translation"] and t["vocabulary"][0]["term"] == "einreden"
    assert t["cached"] is False and t["model"] == "qwen/qwen3.8-27b"
    assert "from German into Spanish" in calls[0]["messages"][0]["content"]
    assert calls[0]["response_format"] == {"type": "json_object"}
    history = client.get("/api/translations", headers=auth_headers, params={"book_id": "die-wolke"}).json()
    assert [h["id"] for h in history] == [t["id"]]


def test_same_passage_comes_from_the_store(client, auth_headers, groq):
    calls, _ = groq
    first = client.post("/api/translate", headers=auth_headers, json=BODY).json()
    again = client.post("/api/translate", headers=auth_headers, json=BODY).json()
    assert again["id"] == first["id"] and again["cached"] is True
    assert len(calls) == 1


def test_broken_json_is_asked_again(client, auth_headers, groq):
    calls, replies = groq
    replies.extend(["not json at all", "```json\n" + json.dumps(GOOD) + "\n```"])
    r = client.post("/api/translate", headers=auth_headers, json=BODY)
    assert r.status_code == 200 and len(calls) == 2


def test_rate_limit_is_passed_on(client, auth_headers, groq):
    _, replies = groq
    replies.append(httpx.Response(429, json={"error": {"message": "Rate limit reached"}}))
    r = client.post("/api/translate", headers=auth_headers, json=BODY)
    assert r.status_code == 429 and "Rate limit" in r.json()["detail"]


def test_vocabulary_as_a_string_is_repaired(client, auth_headers, groq):
    _, replies = groq
    replies.append({**GOOD, "vocabulary": json.dumps(GOOD["vocabulary"])})
    assert client.post("/api/translate", headers=auth_headers, json=BODY).json()["vocabulary"][0]["term"] == "einreden"


def test_detected_language_when_none_given(client, auth_headers, groq):
    t = client.post("/api/translate", headers=auth_headers, json={**BODY, "source_lang": ""}).json()
    assert t["source_lang"] == "de"


def test_history_is_per_reader_and_deletable(client, auth_headers, groq, sent_codes):
    from tests.conftest import add_reader, sign_in
    mine = client.post("/api/translate", headers=auth_headers, json=BODY).json()
    add_reader("other@example.com", "Other")
    other = sign_in(client, sent_codes, "other@example.com")
    assert client.get("/api/translations", headers=other).json() == []
    assert client.delete(f"/api/translations/{mine['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/translations/{mine['id']}", headers=auth_headers).status_code == 204
    assert client.get("/api/translations", headers=auth_headers).json() == []


def test_since_id_returns_only_newer(client, auth_headers, groq):
    a = client.post("/api/translate", headers=auth_headers, json=BODY).json()
    b = client.post("/api/translate", headers=auth_headers, json={**BODY, "text": "Er fuhr an."}).json()
    newer = client.get("/api/translations", headers=auth_headers, params={"since_id": a["id"]}).json()
    assert [t["id"] for t in newer] == [b["id"]]


def test_define_a_word_missing_from_the_dictionaries(client, auth_headers, groq):
    calls, replies = groq
    replies.append({"lemma": "das Strahlenschutzgesetz", "part_of_speech": "sustantivo",
                    "meaning": "ley de protección radiológica", "notes": "compuesto de Strahlenschutz + Gesetz"})
    r = client.post("/api/define", headers=auth_headers, json={
        "word": "Strahlenschutzgesetzes", "context": "Nach dem Strahlenschutzgesetzes…", "language": "de", "target_lang": "es"})
    assert r.status_code == 200 and r.json()["lemma"] == "das Strahlenschutzgesetz"
    assert r.json()["model"] == "qwen/qwen3.8-27b"  # shown under the definition
    assert "German–Spanish dictionary" in calls[0]["messages"][0]["content"]
    assert "SENTENCE: Nach dem" in calls[0]["messages"][1]["content"]


def test_define_without_a_sentence_in_the_same_language(client, auth_headers, groq):
    """The Dictionary page: no sentence, and a definition in the word's own language"""
    calls, replies = groq
    replies.append({"lemma": "das Haus", "part_of_speech": "Substantiv", "meaning": "Gebäude, in dem Menschen wohnen",
                    "notes": ""})
    r = client.post("/api/define", headers=auth_headers, json={"word": "Haus", "language": "de", "target_lang": "de"})
    assert r.status_code == 200 and r.json()["meaning"] == "Gebäude, in dem Menschen wohnen"
    system, user = calls[0]["messages"][0]["content"], calls[0]["messages"][1]["content"]
    assert "monolingual German dictionary" in system and "main meanings" in system and "SENTENCE" not in system
    assert user == "WORD: Haus"
