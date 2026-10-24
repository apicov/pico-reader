import base64
import json
import re

from tests.conftest import add_reader, sign_in
from tests.test_stats import make_book

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def no_email(response):
    """Community responses never show who someone is by email."""
    assert not EMAIL.search(json.dumps(response.json())), response.json()
    return response


def friend(client, sent_codes, email="friend@example.com"):
    add_reader(email, "Friend")
    return sign_in(client, sent_codes, email)


def test_profile_is_created_and_can_be_renamed(client, auth_headers, admin_headers):
    me = no_email(client.get("/api/profiles/me", headers=auth_headers)).json()
    assert me["handle"].startswith("me_") and me["chosen"] is False and me["display_name"] == "Me"
    r = client.put("/api/profiles/me", headers=auth_headers, json={"handle": "Pico", "display_name": "Pico R."})
    assert r.json()["handle"] == "pico" and r.json()["chosen"] is True
    client.get("/api/profiles/me", headers=admin_headers)
    assert client.put("/api/profiles/me", headers=admin_headers, json={"handle": "pico", "display_name": "x"}).status_code == 409
    assert client.put("/api/profiles/me", headers=admin_headers, json={"handle": "a!", "display_name": "x"}).status_code == 422
    assert [m["handle"] for m in client.get("/api/members", headers=admin_headers).json()].count("pico") == 1


def test_avatar_upload_and_public_url(client, auth_headers):
    jpeg = b"\xff\xd8\xff\xe0" + b"0" * 100
    r = client.put("/api/profiles/me/avatar", headers=auth_headers, json={"jpeg_base64": base64.b64encode(jpeg).decode()})
    url = r.json()["avatar_url"]
    img = client.get(url)  # no sign-in needed
    assert img.status_code == 200 and img.content == jpeg and "immutable" in img.headers["cache-control"]
    bad = client.put("/api/profiles/me/avatar", headers=auth_headers, json={"jpeg_base64": base64.b64encode(b"GIF89a").decode()})
    assert bad.status_code == 422
    assert client.put("/api/profiles/me/avatar", headers=auth_headers, json={"jpeg_base64": None}).json()["avatar_url"] is None
    assert client.get(url).status_code == 404


def test_reviews_and_summary(client, admin_headers, auth_headers, bucket):
    b = make_book(client, admin_headers)
    assert client.put(f"/api/books/{b}/review", headers=auth_headers, json={"score": 11}).status_code == 422
    client.put(f"/api/books/{b}/review", headers=auth_headers, json={"score": 8, "recommend": True, "body": "Gripping"})
    client.put(f"/api/books/{b}/review", headers=admin_headers, json={"score": 5})
    r = client.put(f"/api/books/{b}/review", headers=admin_headers, json={"score": 6, "body": "Changed my mind"})
    assert r.json()["score"] == 6 and r.json()["mine"]
    page = no_email(client.get(f"/api/books/{b}/community", headers=auth_headers)).json()
    assert page["summary"] == {"avg_score": 7.0, "review_count": 2, "recommend_count": 1}
    assert page["my_review"]["body"] == "Gripping" and len(page["reviews"]) == 2
    assert client.get("/api/ratings", headers=auth_headers).json()[b]["review_count"] == 2
    client.delete(f"/api/books/{b}/review", headers=auth_headers)
    assert client.get(f"/api/books/{b}/community", headers=auth_headers).json()["my_review"] is None
    assert client.put("/api/books/nope/review", headers=auth_headers, json={"score": 3}).status_code == 404


def test_posts_with_books_quotes_and_permissions(client, admin_headers, auth_headers, sent_codes, bucket):
    b = make_book(client, admin_headers)
    other = friend(client, sent_codes)
    r = client.post("/api/posts", headers=auth_headers, json={
        "title": "Uli", "body": "What a scene", "book_ids": [],
        "quotes": [{"book_id": b, "text": "Starr vor Entsetzen", "format": "epub", "location": "epubcfi(/6/4)", "progress": 0.3}]})
    assert r.status_code == 201
    post = no_email(r).json()
    assert [x["id"] for x in post["books"]] == [b]  # the quoted book is linked
    assert post["quotes"][0]["location"] == "epubcfi(/6/4)" and post["mine"]
    pid = post["id"]
    assert client.post("/api/posts", headers=auth_headers, json={"title": "x", "book_ids": ["nope"]}).status_code == 404
    assert client.put(f"/api/posts/{pid}", headers=other, json={"title": "hacked"}).status_code == 403
    edited = client.put(f"/api/posts/{pid}", headers=auth_headers, json={"title": "Uli!", "body": "Edited", "book_ids": [b]}).json()
    assert edited["edited"] and edited["quotes"] == []
    assert [p["id"] for p in client.get(f"/api/posts?book={b}", headers=other).json()] == [pid]
    me = client.get("/api/profiles/me", headers=auth_headers).json()["handle"]
    assert len(client.get(f"/api/posts?author={me}", headers=other).json()) == 1
    # only posts about books on my shelf
    assert client.get("/api/posts?mine_books=true", headers=other).json() == []
    client.put(f"/api/shelf/{b}", headers=other, json={"status": "reading"})
    assert len(client.get("/api/posts?mine_books=true", headers=other).json()) == 1
    assert client.delete(f"/api/posts/{pid}", headers=other).status_code == 403
    assert client.delete(f"/api/posts/{pid}", headers=admin_headers).status_code == 204  # admins may delete
    assert client.get(f"/api/posts/{pid}", headers=auth_headers).status_code == 404
    assert client.get("/api/posts/not-a-uuid", headers=auth_headers).status_code == 422


def test_comments_replies_and_soft_delete(client, auth_headers, sent_codes):
    other = friend(client, sent_codes)
    pid = client.post("/api/posts", headers=auth_headers, json={"title": "Free topic"}).json()["id"]
    first = client.post(f"/api/posts/{pid}/comments", headers=other, json={"body": "Hi"}).json()[0]
    reply = client.post(f"/api/posts/{pid}/comments", headers=auth_headers, json={"body": "Hello", "parent_id": first["id"]}).json()[1]
    deeper = client.post(f"/api/posts/{pid}/comments", headers=other, json={"body": "Again", "parent_id": reply["id"]}).json()[2]
    assert reply["parent_id"] == first["id"] and deeper["parent_id"] == first["id"]  # one level of replies
    assert client.put(f"/api/comments/{first['id']}", headers=auth_headers, json={"body": "x"}).status_code == 403
    client.delete(f"/api/comments/{first['id']}", headers=other)
    thread = no_email(client.get(f"/api/posts/{pid}", headers=auth_headers)).json()
    assert thread["comment_count"] == 2
    gone = thread["comments"][0]
    assert gone["deleted"] and gone["body"] == "" and gone["author"] is None
    assert len(thread["comments"]) == 3


def test_likes_are_idempotent(client, auth_headers, sent_codes):
    other = friend(client, sent_codes)
    pid = client.post("/api/posts", headers=auth_headers, json={"title": "Like me"}).json()["id"]
    for _ in range(2):
        assert client.put(f"/api/likes/post/{pid}", headers=other).status_code == 204
    client.put(f"/api/likes/post/{pid}", headers=auth_headers)
    p = client.get(f"/api/posts/{pid}", headers=other).json()
    assert p["likes"] == 2 and p["liked_by_me"]
    client.delete(f"/api/likes/post/{pid}", headers=other)
    assert client.get(f"/api/posts/{pid}", headers=other).json()["likes"] == 1
    assert client.put(f"/api/likes/list/{pid}", headers=other).status_code == 404
    assert client.put("/api/likes/post/00000000-0000-0000-0000-000000000000", headers=other).status_code == 404


def test_lists_keep_their_order(client, admin_headers, auth_headers, sent_codes, bucket):
    books = [make_book(client, admin_headers) for _ in range(3)]
    other = friend(client, sent_codes)
    r = client.post("/api/lists", headers=auth_headers, json={
        "title": "Top 3", "items": [{"book_id": b, "note": f"#{i}"} for i, b in enumerate(books)]})
    lid = r.json()["id"]
    reordered = client.put(f"/api/lists/{lid}", headers=auth_headers, json={
        "title": "Top 3", "items": [{"book_id": books[2]}, {"book_id": books[0], "note": "still good"}]}).json()
    assert [i["book"]["id"] for i in reordered["items"]] == [books[2], books[0]]
    assert client.put(f"/api/lists/{lid}", headers=other, json={"title": "x"}).status_code == 403
    dup = client.post("/api/lists", headers=auth_headers, json={"title": "d", "items": [{"book_id": books[0]}] * 2})
    assert dup.status_code == 422
    handle = client.get("/api/profiles/me", headers=auth_headers).json()["handle"]
    prof = no_email(client.get(f"/api/profiles/{handle}", headers=other)).json()
    assert prof["lists"][0]["title"] == "Top 3" and not prof["mine"]


def test_admin_hides_content(client, admin_headers, auth_headers, sent_codes):
    other = friend(client, sent_codes)
    pid = client.post("/api/posts", headers=auth_headers, json={"title": "Spam?"}).json()["id"]
    cid = client.post(f"/api/posts/{pid}/comments", headers=other, json={"body": "rude"}).json()[0]["id"]
    assert client.post(f"/api/admin/hide/comment/{cid}", headers=auth_headers).status_code == 403
    client.post(f"/api/admin/hide/comment/{cid}", headers=admin_headers)
    seen = client.get(f"/api/posts/{pid}", headers=auth_headers).json()["comments"][0]
    assert seen["body"] == "" and seen["author"] is None
    assert client.get(f"/api/posts/{pid}", headers=admin_headers).json()["comments"][0]["body"] == "rude"
    client.post(f"/api/admin/hide/post/{pid}", headers=admin_headers)
    assert client.get(f"/api/posts/{pid}", headers=other).status_code == 404
    assert client.get("/api/posts", headers=other).json() == []
    client.delete(f"/api/admin/hide/post/{pid}", headers=admin_headers)
    assert len(client.get("/api/posts", headers=other).json()) == 1


def test_a_deleted_book_stays_in_old_posts(client, admin_headers, auth_headers, bucket):
    b = make_book(client, admin_headers)
    pid = client.post("/api/posts", headers=auth_headers, json={"title": "About it", "book_ids": [b]}).json()["id"]
    client.delete(f"/api/admin/books/{b}", headers=admin_headers)
    book = client.get(f"/api/posts/{pid}", headers=auth_headers).json()["books"][0]
    assert book == {"id": b, "title": "", "author": "", "available": False}


def test_profile_shows_reading_only_when_allowed(client, admin_headers, auth_headers, sent_codes, bucket):
    b = make_book(client, admin_headers)
    other = friend(client, sent_codes)
    client.put(f"/api/shelf/{b}", headers=auth_headers, json={"status": "reading"})
    handle = client.get("/api/profiles/me", headers=auth_headers).json()["handle"]
    assert [x["id"] for x in client.get(f"/api/profiles/{handle}", headers=other).json()["reading"]] == [b]
    client.put("/api/profiles/me", headers=auth_headers, json={"handle": handle, "display_name": "Me", "show_reading": False})
    assert client.get(f"/api/profiles/{handle}", headers=other).json()["reading"] == []
    assert client.get("/api/profiles/nobody", headers=other).status_code == 404


def test_generated_handles_are_valid():
    from app.community import HANDLE, generated_handle
    assert HANDLE.fullmatch(generated_handle("A.Very-Long.Name+tag@example.com"))


def test_library_never_shows_who_uploaded(client, admin_headers, auth_headers, bucket):
    make_book(client, admin_headers)
    books = no_email(client.get("/api/library", headers=auth_headers)).json()["books"]
    assert books[0]["can_change"] is False
    assert client.get("/api/library", headers=admin_headers).json()["books"][0]["can_change"] is True
