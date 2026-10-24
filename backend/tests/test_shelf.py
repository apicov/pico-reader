from tests.test_stats import make_book


def put_progress(client, headers, book_id, progress, when="2026-10-24T10:00:00Z"):
    client.put("/api/progress", headers=headers, json={"book_id": book_id, "format": "epub", "location": "x",
                                                       "progress": progress, "updated_at": when})


def test_opening_starts_finishing_and_removing(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    r = client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "reading", "only_if_new": True})
    assert r.json()["status"] == "reading"
    put_progress(client, admin_headers, b, 0.4)
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["progress"] == 0.4
    put_progress(client, admin_headers, b, 0.99, "2026-10-24T11:00:00Z")
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "finished"
    # opening it again doesn't move it back to "reading"
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "reading", "only_if_new": True})
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "finished"
    # but choosing "reading" does
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "reading"})
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "reading"
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "removed"})
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "removed"


def test_each_reader_has_their_own_shelf(client, admin_headers, auth_headers, bucket):
    b = make_book(client, admin_headers)
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "reading"})
    assert client.get("/api/shelf", headers=auth_headers).json() == []
    client.put(f"/api/shelf/{b}", headers=auth_headers, json={"status": "finished"})
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "reading"


def test_unknown_book(client, auth_headers):
    assert client.put("/api/shelf/nope", headers=auth_headers, json={"status": "reading"}).status_code == 404


def test_opening_a_removed_book_brings_it_back(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "removed"})
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "reading", "only_if_new": True})
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "reading"
