from app.routes import notes as notes_routes
from tests.test_chat import ask, call, groq, new, say  # noqa: F401 (fixtures)
from tests.test_search import fake_embed, fresh_query_cache, indexed_book  # noqa: F401 (fixtures)

DIAGRAM = "```mermaid\nflowchart LR\n  A[\"Pruning\"] --> B[\"Smaller model\"]\n```"


def propose(client, headers, groq, tool, args, cid="conv-00000001", search=True):
    groq.steps += ([call("search_passages", {"query": "pruning"}, "c0")] if search else []) + [
        call(tool, args), say("I proposed a note.")]
    new(client, headers, cid)
    evs = ask(client, headers, cid, "Make me a note")
    return cid, next(d for n, d in evs if n == "action")


def confirm(client, headers, cid, action):
    return client.post(f"/api/conversations/{cid}/actions/{action['id']}", headers=headers, json={"approve": True})


def test_a_note_is_saved_only_after_confirming_with_its_sources(client, admin_headers, indexed_book, groq):
    md = f"## Pruning\n\nIt removes small weights [1]. Not a source [7].\n\n{DIAGRAM}"
    cid, action = propose(client, admin_headers, groq, "save_note",
                          {"title": "Pruning notes", "markdown": md, "book": "Efficient"})
    assert action["label"] == "Save note: Pruning notes" and action["preview"] == md
    assert client.get("/api/notes", headers=admin_headers).json() == []  # not yet
    assert confirm(client, admin_headers, cid, action).json()["content"] == "Done: Save note: Pruning notes."
    [note] = client.get("/api/notes", headers=admin_headers).json()
    assert note["book_id"] == indexed_book and note["book_title"] == "Efficient ML"
    assert "weights [1]." in note["markdown"] and "[7]" not in note["markdown"] and DIAGRAM in note["markdown"]
    assert len(note["sources"]) == 1 and note["sources"][0]["heading"] == "1 Pruning"
    # the preview stays with the chat message
    stored = client.get(f"/api/conversations/{cid}", headers=admin_headers).json()["messages"][1]
    assert stored["extras"]["actions"][0]["preview"] == md


def test_appending_numbers_new_citations_after_the_old_ones(client, admin_headers, indexed_book, groq):
    cid, action = propose(client, admin_headers, groq, "save_note", {"title": "Pruning", "markdown": "First [1]."})
    confirm(client, admin_headers, cid, action)
    cid, action = propose(client, admin_headers, groq, "append_to_note",
                          {"note": "prun", "markdown": "## More\n\nAgain [1]."}, cid="conv-00000002")
    assert action["label"] == "Add to note: prun"
    confirm(client, admin_headers, cid, action)
    [note] = client.get("/api/notes", headers=admin_headers).json()
    assert note["markdown"] == "First [1].\n\n## More\n\nAgain [2].\n" and len(note["sources"]) == 2


def test_the_agent_lists_and_reads_notes(client, admin_headers, indexed_book, groq):
    import json
    with _db() as db:
        notes_routes.create_note(db, "boss@example.com", "Pruning", "It removes weights [1].", None, [{"x": 1}])
    groq.steps += [call("list_notes", {}), call("read_note", {"note": "pruning"}, "c2"), say("You have one note.")]
    new(client, admin_headers)
    ask(client, admin_headers, "conv-00000001", "What notes do I have?")
    listed, read = [json.loads(m["content"]) for m in groq.agent_calls[-1]["messages"] if m["role"] == "tool"]
    assert listed["notes"][0]["title"] == "Pruning"
    assert read["markdown"] == "It removes weights."  # the note's own citations aren't offered for citing


def test_edit_delete_and_privacy(client, admin_headers, auth_headers, indexed_book, groq):
    cid, action = propose(client, admin_headers, groq, "save_note", {"title": "Mine", "markdown": "Text"}, search=False)
    confirm(client, admin_headers, cid, action)
    [note] = client.get("/api/notes", headers=admin_headers).json()
    assert client.get("/api/notes", headers=auth_headers).json() == []
    assert client.get(f"/api/notes/{note['id']}", headers=auth_headers).status_code == 404
    assert client.patch(f"/api/notes/{note['id']}", headers=auth_headers, json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/notes/{note['id']}", headers=auth_headers).status_code == 404
    r = client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"title": "Renamed", "markdown": "New"})
    assert r.json()["title"] == "Renamed" and r.json()["markdown"] == "New"
    too_long = "x" * (notes_routes.MAX_CHARS + 1)
    assert client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"markdown": too_long}).status_code == 422
    assert client.delete(f"/api/notes/{note['id']}", headers=admin_headers).status_code == 204
    assert client.get("/api/notes", headers=admin_headers).json() == []


def test_limits_reach_the_reader_as_a_failed_action(client, admin_headers, indexed_book, groq, monkeypatch):
    monkeypatch.setattr(notes_routes, "MAX_NOTES", 0)
    cid, action = propose(client, admin_headers, groq, "save_note", {"title": "One", "markdown": "Text"}, search=False)
    assert confirm(client, admin_headers, cid, action).json()["content"].startswith("Couldn't do it: You have 0 notes")


def test_filter_by_book_and_book_deletion_keeps_the_note(client, admin_headers, indexed_book, groq):
    with _db() as db:
        notes_routes.create_note(db, "boss@example.com", "About it", "x", indexed_book, [])
        notes_routes.create_note(db, "boss@example.com", "Loose", "y", None, [])
    assert [n["title"] for n in client.get(f"/api/notes?book={indexed_book}", headers=admin_headers).json()] == ["About it"]
    client.delete(f"/api/books/{indexed_book}", headers=admin_headers)
    assert {n["title"]: n["book_id"] for n in client.get("/api/notes", headers=admin_headers).json()} == \
        {"About it": None, "Loose": None}


def _db():
    from sqlalchemy.orm import sessionmaker
    from app.db import get_engine
    return sessionmaker(bind=get_engine())()


def test_a_note_about_a_book_deleted_before_confirming_fails_cleanly(client, admin_headers, indexed_book, groq):
    cid, action = propose(client, admin_headers, groq, "save_note",
                          {"title": "Gone", "markdown": "Text", "book": "Efficient"}, search=False)
    client.delete(f"/api/books/{indexed_book}", headers=admin_headers)
    r = confirm(client, admin_headers, cid, action)
    assert r.status_code == 200 and r.json()["content"].startswith("Couldn't do it")
    assert client.get("/api/notes", headers=admin_headers).json() == []
