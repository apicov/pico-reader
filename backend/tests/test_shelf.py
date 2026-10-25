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


def test_my_shelf_add_list_remove(client, admin_headers, auth_headers, bucket):
    a, b = make_book(client, admin_headers), make_book(client, admin_headers)
    assert client.put(f"/api/shelf/mine/{a}", headers=admin_headers).status_code == 204
    client.put(f"/api/shelf/mine/{b}", headers=admin_headers)
    client.put(f"/api/shelf/mine/{a}", headers=admin_headers)  # adding twice is fine
    assert [e["book_id"] for e in client.get("/api/shelf/mine", headers=admin_headers).json()] == [b, a]
    assert client.get("/api/shelf/mine", headers=auth_headers).json() == []
    assert client.delete(f"/api/shelf/mine/{b}", headers=admin_headers).status_code == 204
    assert [e["book_id"] for e in client.get("/api/shelf/mine", headers=admin_headers).json()] == [a]


def test_my_shelf_is_apart_from_reading_status(client, admin_headers, bucket):
    b = make_book(client, admin_headers)
    client.put(f"/api/shelf/mine/{b}", headers=admin_headers)
    put_progress(client, admin_headers, b, 0.99)
    client.put(f"/api/shelf/{b}", headers=admin_headers, json={"status": "removed"})
    assert [e["book_id"] for e in client.get("/api/shelf/mine", headers=admin_headers).json()] == [b]
    assert client.get("/api/shelf", headers=admin_headers).json()[0]["status"] == "removed"


def test_my_shelf_unknown_book(client, auth_headers):
    assert client.put("/api/shelf/mine/nope", headers=auth_headers).status_code == 404


def test_collections_group_my_shelf_books(client, admin_headers, auth_headers, bucket):
    a, b = make_book(client, admin_headers), make_book(client, admin_headers)
    put = lambda path, **kw: client.put(path, headers=admin_headers, **kw)
    assert put("/api/shelf/collections/col-00000001", json={"name": "Uni", "position": 1}).status_code == 204
    put("/api/shelf/collections/col-00000002", json={"name": "Krimis", "position": 0})
    # adding to a collection puts the book on My shelf
    assert put(f"/api/shelf/collections/col-00000001/books/{a}").status_code == 204
    put(f"/api/shelf/collections/col-00000001/books/{b}")
    put(f"/api/shelf/collections/col-00000002/books/{a}")  # a book can be in several
    put(f"/api/shelf/collections/col-00000002/books/{a}")  # twice is fine
    assert {e["book_id"] for e in client.get("/api/shelf/mine", headers=admin_headers).json()} == {a, b}
    cols = client.get("/api/shelf/collections", headers=admin_headers).json()
    assert [(c["name"], sorted(c["book_ids"])) for c in cols] == [("Krimis", [a]), ("Uni", sorted([a, b]))]
    # rename and move
    put("/api/shelf/collections/col-00000001", json={"name": "Studium", "position": 0})
    put("/api/shelf/collections/col-00000002", json={"name": "Krimis", "position": 1})
    assert [c["name"] for c in client.get("/api/shelf/collections", headers=admin_headers).json()] == ["Studium", "Krimis"]
    # off My shelf is out of its collections; the collection itself stays
    client.delete(f"/api/shelf/mine/{a}", headers=admin_headers)
    cols = {c["name"]: c["book_ids"] for c in client.get("/api/shelf/collections", headers=admin_headers).json()}
    assert cols == {"Studium": [b], "Krimis": []}
    # deleting a collection keeps its books on My shelf
    assert client.delete("/api/shelf/collections/col-00000001", headers=admin_headers).status_code == 204
    assert [e["book_id"] for e in client.get("/api/shelf/mine", headers=admin_headers).json()] == [b]
    client.delete(f"/api/shelf/collections/col-00000002/books/{b}", headers=admin_headers)


def test_collections_are_private_and_checked(client, admin_headers, auth_headers, bucket):
    b = make_book(client, admin_headers)
    client.put("/api/shelf/collections/col-00000003", headers=admin_headers, json={"name": "Mine"})
    assert client.get("/api/shelf/collections", headers=auth_headers).json() == []
    for r in (client.put("/api/shelf/collections/col-00000003", headers=auth_headers, json={"name": "Taken"}),
              client.delete("/api/shelf/collections/col-00000003", headers=auth_headers),
              client.put(f"/api/shelf/collections/col-00000003/books/{b}", headers=auth_headers),
              client.put("/api/shelf/collections/col-00000003/books/nope", headers=admin_headers)):
        assert r.status_code == 404
    assert client.put("/api/shelf/collections/bad id", headers=admin_headers, json={"name": "x"}).status_code == 422
    assert client.put("/api/shelf/collections/col-00000004", headers=admin_headers, json={"name": ""}).status_code == 422
    assert client.put("/api/shelf/collections/col-00000004", headers=admin_headers, json={"name": "x" * 61}).status_code == 422


def test_the_agent_sees_collections(client, admin_headers, bucket):
    from app import agent_tools
    from app.auth import find_reader
    from app.db import get_engine
    from sqlalchemy.orm import sessionmaker
    b = make_book(client, admin_headers)
    client.put("/api/shelf/collections/col-00000005", headers=admin_headers, json={"name": "Uni"})
    client.put(f"/api/shelf/collections/col-00000005/books/{b}", headers=admin_headers)
    with sessionmaker(bind=get_engine())() as db:
        ctx = agent_tools.Context(db=db, reader=find_reader(db, "boss@example.com"), tz="UTC", sources=[])
        [book] = agent_tools.list_books(ctx)["books"]
    assert book["collections"] == ["Uni"] and book["on_my_shelf"] is True
