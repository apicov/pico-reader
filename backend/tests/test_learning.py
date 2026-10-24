from tests.test_stats import TZ, lookup, make_book, session

CARD = {"language": "de", "term": "die Mühe", "meaning": "el esfuerzo", "example": "Sie hatten Mühe.",
        "state": {"stability": 1.2, "reps": 1}, "due": "2026-10-25T10:00:00Z", "client_updated_at": "2026-10-24T10:00:00Z"}


def test_known_words_leave_lists(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    client.post("/api/events", headers=admin_headers, json={"sessions": [session(1, b, 0, 600)], "lookups": [
        lookup(1, b, "Häuser", matched="Haus"), lookup(2, b, "Haus", matched="Haus"), lookup(3, b, "Wagen", matched="Wagen")]})
    assert sorted(client.get("/api/looked-up-words", headers=admin_headers, params={"language": "de"}).json()) == ["haus", "häuser", "wagen"]
    client.put("/api/known-words", headers=admin_headers, json={"language": "de", "word": "Haus"})
    assert client.get("/api/looked-up-words", headers=admin_headers, params={"language": "de"}).json() == ["wagen"]
    stats = client.get("/api/stats", headers=admin_headers, params={"tz": TZ}).json()
    assert stats["repeated"] == [] and stats["known_words"] == 1
    client.put("/api/known-words", headers=admin_headers, json={"language": "de", "word": "haus", "known": False})
    assert client.get("/api/known-words", headers=admin_headers).json() == []


def test_lookup_keeps_its_sentence(client, auth_headers):
    from sqlalchemy import text
    from app.db import get_engine
    client.post("/api/events", headers=auth_headers, json={"lookups": [{**lookup(9, "b", "Wagen"), "context": "Der Wagen fuhr."}]})
    with get_engine().connect() as c:
        assert c.execute(text("SELECT context FROM lookups")).scalar() == "Der Wagen fuhr."


def test_review_cards_sync(client, auth_headers):
    saved = client.put("/api/review-cards/card-00000001", headers=auth_headers, json=CARD).json()
    assert saved["state"]["reps"] == 1
    first = client.get("/api/review-cards", headers=auth_headers).json()
    assert [c["term"] for c in first["cards"]] == ["die Mühe"]
    stale = client.put("/api/review-cards/card-00000001", headers=auth_headers,
                       json={**CARD, "state": {"reps": 0}, "client_updated_at": "2026-10-23T10:00:00Z"})
    assert stale.json()["state"]["reps"] == 1
    client.put("/api/review-cards/card-00000001", headers=auth_headers,
               json={**CARD, "deleted": True, "client_updated_at": "2026-10-24T11:00:00Z"})
    changed = client.get("/api/review-cards", headers=auth_headers, params={"since": first["cursor"]}).json()["cards"]
    assert changed[0]["deleted"] is True
    stats = client.get("/api/stats", headers=auth_headers, params={"tz": TZ}).json()
    assert stats["review_due"] == 0


def test_cards_are_private(client, auth_headers, admin_headers):
    client.put("/api/review-cards/card-00000002", headers=auth_headers, json=CARD)
    assert client.get("/api/review-cards", headers=admin_headers).json()["cards"] == []
    assert client.put("/api/review-cards/card-00000002", headers=admin_headers,
                      json={**CARD, "client_updated_at": "2027-01-01T00:00:00Z"}).status_code == 404
