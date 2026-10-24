import pytest

from app import categories, groq_client
from tests.test_books import run_queue, upload_epub
from tests.test_search import fake_embed, indexed_book  # noqa: F401 (fixtures)


@pytest.fixture
def answers(monkeypatch):
    """What the fake LLM answers, in order; the prompts it got."""
    replies, prompts = [], []

    def chat_json(system, user, max_tokens=1500, who=None):
        prompts.append({"user": user, "who": who})
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply, "fake"

    monkeypatch.setattr(groq_client, "chat_json", chat_json)
    return replies, prompts


@pytest.fixture
def db():
    """A session of our own, closed after the test (an open one would block the next test's TRUNCATE)."""
    from sqlalchemy.orm import sessionmaker

    from app.db import get_engine
    session = sessionmaker(bind=get_engine())()
    yield session
    session.close()


def node(client, headers, path):
    return next(n for n in client.get("/api/categories", headers=headers).json() if n["path"] == path)


def test_the_seeded_tree(client, auth_headers):
    tree = client.get("/api/categories", headers=auth_headers).json()
    paths = {n["path"] for n in tree}
    assert {"Literature", "Academic", "Non-fiction", "Literature > Science fiction > Space opera",
            "Literature > Fantasy > Urban fantasy", "Academic > Computer science & AI"} <= paths
    assert max(n["depth"] for n in tree) == 3 and all(n["status"] == "approved" for n in tree)


def test_the_ai_picks_an_existing_category(client, admin_headers, indexed_book, answers, db):
    replies, prompts = answers
    replies.append({"category": "academic > computer science & ai", "second": "Non-fiction › Popular science",
                    "reason": "A course on efficient deep learning.", "confidence": 0.9})
    result = categories.classify(db, indexed_book)
    assert result["category"] == "Academic > Computer science & AI" and result["second"] == "Non-fiction > Popular science"
    assert "Pruning" in prompts[0]["user"] and "Literature > Science fiction > Space opera" in prompts[0]["user"]
    assert prompts[0]["who"] == ("boss@example.com", "categorize")
    [book] = client.get("/api/library", headers=admin_headers).json()["books"]
    assert book["category_id"] == node(client, admin_headers, "Academic > Computer science & AI")["id"]
    assert book["category_reason"].startswith("A course")
    assert node(client, admin_headers, "Academic")["books"] == 1  # counted up the tree
    # it's not asked again unless forced
    assert categories.classify(db, indexed_book) is None


def test_new_categories_only_under_existing_ones(client, admin_headers, indexed_book, answers, db):
    replies, _ = answers
    replies.append({"category": None, "new": {"parent": "Literature", "name": "Solarpunk"}, "reason": "x"})
    assert categories.classify(db, indexed_book)["category"] == "Literature > Solarpunk"
    sp = node(client, admin_headers, "Literature > Solarpunk")
    assert sp["status"] == "suggested"
    # the same suggestion again is reused; too deep or at the top level is refused
    replies.append({"category": None, "new": {"parent": "Literature", "name": "solarpunk"}})
    categories.classify(db, indexed_book, force=True)
    assert [n["path"] for n in client.get("/api/categories", headers=admin_headers).json()].count("Literature > Solarpunk") == 1
    replies.append({"category": None, "new": {"parent": "Literature > Science fiction > Space opera", "name": "Too deep"}})
    assert categories.classify(db, indexed_book, force=True) is None
    replies.append({"category": "Nowhere > Land", "new": {"parent": None, "name": "Top"}})
    assert categories.classify(db, indexed_book, force=True) is None
    assert not any(n["path"] in ("Top", "Literature > Science fiction > Space opera > Too deep")
                   for n in client.get("/api/categories", headers=admin_headers).json())


def test_a_readers_choice_wins(client, admin_headers, indexed_book, answers, auth_headers, db):
    replies, _ = answers
    hard_sf = node(client, admin_headers, "Literature > Science fiction > Hard SF")["id"]
    assert client.put(f"/api/books/{indexed_book}/category", headers=auth_headers, json={"category_id": hard_sf}).status_code == 403
    assert client.put(f"/api/books/{indexed_book}/category", headers=admin_headers, json={"category_id": hard_sf}).status_code == 204
    assert categories.classify(db, indexed_book, force=True) is None  # not overwritten
    # "Suggest again" asks the AI on purpose
    replies.append({"category": "Academic > Computer science & AI", "reason": "ML"})
    r = client.post(f"/api/books/{indexed_book}/categorize", headers=admin_headers)
    assert r.json()["category"] == "Academic > Computer science & AI"
    assert client.put(f"/api/books/{indexed_book}/category", headers=admin_headers, json={"category_id": 99999}).status_code == 404


def test_indexing_categorizes_and_survives_an_llm_failure(client, auth_headers, bucket, fake_embed, answers):  # noqa: F811
    replies, prompts = answers
    replies.append({"category": "Literature > Young adult & children", "reason": "A story for young readers."})
    first = upload_epub(client, auth_headers)
    run_queue()
    replies.append(groq_client.GroqError("Groq is down"))
    second = upload_epub(client, auth_headers, title="Noch ein Buch")
    run_queue()
    books = {b["id"]: b for b in client.get("/api/library", headers=auth_headers).json()["books"]}
    assert books[first]["category_id"] == node(client, auth_headers, "Literature > Young adult & children")["id"]
    assert books[second]["category_id"] is None and books[second]["index"]  # indexed all the same
    assert prompts[0]["who"] == ("me@example.com", "categorize")


def test_a_category_chosen_at_upload_is_kept(client, auth_headers, bucket, fake_embed, answers):  # noqa: F811
    fantasy = node(client, auth_headers, "Literature > Fantasy")["id"]
    book = upload_epub(client, auth_headers, category_id=fantasy)
    run_queue()  # the AI isn't asked
    assert answers[1] == []
    assert client.get("/api/library", headers=auth_headers).json()["books"][0]["category_id"] == fantasy
    assert book


def test_admins_manage_the_tree(client, admin_headers, auth_headers, indexed_book):
    lit = node(client, admin_headers, "Literature")["id"]
    assert client.post("/api/admin/categories", headers=auth_headers, json={"parent_id": lit, "name": "x"}).status_code == 403
    new = client.post("/api/admin/categories", headers=admin_headers, json={"parent_id": lit, "name": "Westerns"}).json()
    assert new["path"] == "Literature > Westerns"
    sf = node(client, admin_headers, "Literature > Science fiction")["id"]
    deep = node(client, admin_headers, "Literature > Science fiction > Cyberpunk")["id"]
    assert client.post("/api/admin/categories", headers=admin_headers, json={"parent_id": deep, "name": "x"}).status_code == 422
    # merging moves the books and the subcategories
    client.put(f"/api/books/{indexed_book}/category", headers=admin_headers, json={"category_id": new["id"]})
    assert client.post(f"/api/admin/categories/{new['id']}/merge", headers=admin_headers, json={"into": sf}).status_code == 204
    assert client.get("/api/library", headers=admin_headers).json()["books"][0]["category_id"] == sf
    assert client.delete(f"/api/admin/categories/{sf}", headers=admin_headers).status_code == 409  # not empty
    renamed = client.put(f"/api/admin/categories/{deep}", headers=admin_headers, json={"name": "Cyberpunk & biopunk"}).json()
    assert renamed["path"] == "Literature > Science fiction > Cyberpunk & biopunk"
    clash = client.put(f"/api/admin/categories/{deep}", headers=admin_headers, json={"name": "Hard SF"})
    assert clash.status_code == 409
    # moving a 2-level branch under a level-2 node would make 4 levels
    assert client.put(f"/api/admin/categories/{sf}", headers=admin_headers,
                      json={"move": True, "parent_id": node(client, admin_headers, "Literature > Horror")["id"]}).status_code == 422
    empty = client.post("/api/admin/categories", headers=admin_headers, json={"parent_id": lit, "name": "Empty"}).json()
    assert client.delete(f"/api/admin/categories/{empty['id']}", headers=admin_headers).status_code == 204
