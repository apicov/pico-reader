from datetime import datetime, timedelta

HL = {"book_id": "b1", "kind": "highlight", "format": "epub", "location": "epubcfi(/6/8!/4/2,/1:0,/1:20)",
      "progress": 0.12, "text": "Sie hatten Mühe", "color": "yellow", "client_updated_at": "2026-10-24T10:00:00Z"}


def test_create_and_pull(client, auth_headers):
    r = client.put("/api/annotations/aaaaaaaa-1", headers=auth_headers, json=HL)
    assert r.status_code == 200 and r.json()["text"] == "Sie hatten Mühe"
    first = client.get("/api/annotations", headers=auth_headers).json()
    assert [a["id"] for a in first["annotations"]] == ["aaaaaaaa-1"]
    # a later pull repeats only the last seconds (the overlap), not older rows
    from sqlalchemy import text
    from app.db import get_engine
    with get_engine().begin() as c:
        c.execute(text("UPDATE annotations SET updated_at = now() - interval '1 minute'"))
    since = client.get("/api/annotations", headers=auth_headers).json()["cursor"]
    later = (datetime.fromisoformat(since) + timedelta(seconds=30)).isoformat()
    assert client.get("/api/annotations", headers=auth_headers, params={"since": later}).json()["annotations"] == []


def test_newest_edit_wins_and_deletes_sync(client, auth_headers):
    client.put("/api/annotations/aaaaaaaa-2", headers=auth_headers, json={**HL, "note": "new", "client_updated_at": "2026-10-24T12:00:00Z"})
    stale = client.put("/api/annotations/aaaaaaaa-2", headers=auth_headers, json={**HL, "note": "old"})
    assert stale.json()["note"] == "new"
    cursor = client.get("/api/annotations", headers=auth_headers).json()["cursor"]
    client.put("/api/annotations/aaaaaaaa-2", headers=auth_headers, json={**HL, "deleted": True, "client_updated_at": "2026-10-24T13:00:00Z"})
    changed = client.get("/api/annotations", headers=auth_headers, params={"since": cursor}).json()["annotations"]
    assert [(a["id"], a["deleted"]) for a in changed] == [("aaaaaaaa-2", True)]


def test_others_cannot_touch_mine(client, auth_headers, sent_codes):
    from tests.conftest import add_reader, sign_in
    client.put("/api/annotations/aaaaaaaa-3", headers=auth_headers, json=HL)
    add_reader("other@example.com", "Other")
    other = sign_in(client, sent_codes, "other@example.com")
    assert client.get("/api/annotations", headers=other).json()["annotations"] == []
    assert client.put("/api/annotations/aaaaaaaa-3", headers=other,
                      json={**HL, "client_updated_at": "2027-01-01T00:00:00Z"}).status_code == 404
