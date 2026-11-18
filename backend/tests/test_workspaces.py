from tests.conftest import sign_in

WS = "ws-0a1b2c3d-1111-2222-3333-444455556666"


def put(client, headers, when, ws=WS, **body):
    return client.put(f"/api/workspaces/{ws}", headers=headers,
                      json={"name": "Thesis", "book_ids": ["b1", "b2"], "position": 0, "updated_at": when, **body})


def test_a_workspace_is_kept_and_listed(client, auth_headers):
    saved = put(client, auth_headers, "2026-10-24T10:00:00Z").json()
    assert saved["name"] == "Thesis" and saved["book_ids"] == ["b1", "b2"]
    [listed] = client.get("/api/workspaces", headers=auth_headers).json()
    assert listed["id"] == WS and listed["updated_at"].startswith("2026-10-24T10:00:00")


def test_the_newest_change_wins(client, auth_headers):
    put(client, auth_headers, "2026-10-24T10:00:00Z", name="New")
    # a device that was offline sends an older change: it gets the newer one back
    assert put(client, auth_headers, "2026-10-20T10:00:00Z", name="Old").json()["name"] == "New"
    assert put(client, auth_headers, "2026-10-25T10:00:00Z", name="Newer").json()["name"] == "Newer"


def test_a_device_clock_ahead_is_clamped(client, auth_headers):
    saved = put(client, auth_headers, "2099-01-01T00:00:00Z").json()
    assert not saved["updated_at"].startswith("2099")


def test_a_deleted_workspace_stays_deleted(client, auth_headers):
    put(client, auth_headers, "2026-10-24T10:00:00Z")
    assert put(client, auth_headers, "2026-10-24T11:00:00Z", deleted=True).json()["deleted"] is True
    assert client.get("/api/workspaces", headers=auth_headers).json() == []
    # another device's change, older or newer, doesn't bring it back
    put(client, auth_headers, "2026-10-24T10:30:00Z")
    put(client, auth_headers, "2026-10-24T12:00:00Z")
    assert client.get("/api/workspaces", headers=auth_headers).json() == []


def test_limits_and_ids(client, auth_headers):
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", ws="col-123").status_code == 422
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", name="   ").status_code == 422
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", name="x" * 61).status_code == 422
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", book_ids=[f"b{i}" for i in range(9)]).status_code == 422
    assert put(client, auth_headers, "2026-10-24T10:00:00", ).status_code == 422  # no time zone
    # a book twice is kept once
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", book_ids=["b1", "b2", "b1"]).json()["book_ids"] == ["b1", "b2"]


def test_at_most_fifty(client, auth_headers, monkeypatch):
    from app.routes import workspaces
    monkeypatch.setattr(workspaces, "MAX_WORKSPACES", 2)
    for i in range(2):
        assert put(client, auth_headers, "2026-10-24T10:00:00Z", ws=f"ws-0000000{i}").status_code == 200
    assert put(client, auth_headers, "2026-10-24T10:00:00Z", ws="ws-00000009").status_code == 422


def test_another_readers_workspaces_are_not_seen(client, auth_headers, sent_codes):
    from tests.conftest import add_reader
    put(client, auth_headers, "2026-10-24T10:00:00Z")
    add_reader("other@example.com", "Other")
    other = sign_in(client, sent_codes, "other@example.com")
    assert client.get("/api/workspaces", headers=other).json() == []
    assert put(client, other, "2026-10-25T10:00:00Z").status_code == 404
