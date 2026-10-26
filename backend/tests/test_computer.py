from sqlalchemy import text

from app.db import get_engine
from app.routes import computer
from tests.test_chat import ask, call, groq, new, say  # noqa: F401 (fixtures)
from tests.test_search import fake_embed, fresh_query_cache, indexed_book  # noqa: F401 (fixtures)

SNIPPET = {"kind": "snippet", "title": "List comprehension", "language": "Python",
           "body": "squares = [x * x for x in range(10)]", "meta": {"heading": "2 Lists", "progress": 0.2}}


def test_sent_items_wait_until_the_computer_collects_them(client, admin_headers, indexed_book):
    assert client.get("/api/computer", headers=admin_headers).json() == {"seen_at": None, "waiting": 0}
    a = client.post("/api/drops", headers=admin_headers, json=SNIPPET).json()["id"]
    b = client.post("/api/drops", headers=admin_headers, json={
        "kind": "highlight", "body": "Pruning removes small weights.", "meta": {"book_id": indexed_book}}).json()["id"]
    assert client.get("/api/computer", headers=admin_headers).json()["waiting"] == 2
    drops = client.get("/api/drops", headers=admin_headers).json()
    assert [d["id"] for d in drops] == [a, b]  # oldest first
    assert drops[0]["language"] == "python" and drops[1]["meta"]["book_title"] == "Efficient ML"
    status = client.get("/api/computer", headers=admin_headers).json()
    assert status["seen_at"] is not None  # collecting counts as the computer syncing
    assert client.post(f"/api/drops/{a}/delivered", headers=admin_headers).status_code == 204
    assert client.post(f"/api/drops/{a}/delivered", headers=admin_headers).status_code == 204  # twice is fine
    assert [d["id"] for d in client.get("/api/drops", headers=admin_headers).json()] == [b]


def test_a_resend_with_the_same_id_is_one_item_and_ids_are_private(client, admin_headers, auth_headers):
    body = {**SNIPPET, "id": "drop-00000000-1111"}
    client.post("/api/drops", headers=admin_headers, json=body)
    client.post("/api/drops", headers=admin_headers, json=body)
    assert len(client.get("/api/drops", headers=admin_headers).json()) == 1
    assert client.post("/api/drops", headers=auth_headers, json=body).status_code == 409
    assert client.get("/api/drops", headers=auth_headers).json() == []
    assert client.post("/api/drops/drop-00000000-1111/delivered", headers=auth_headers).status_code == 404


def test_limits(client, admin_headers, monkeypatch):
    assert client.post("/api/drops", headers=admin_headers, json={**SNIPPET, "body": ""}).status_code == 422
    assert client.post("/api/drops", headers=admin_headers, json={**SNIPPET, "kind": "pdf"}).status_code == 422
    assert client.post("/api/drops", headers=admin_headers, json={**SNIPPET, "body": "x" * 200_001}).status_code == 422
    monkeypatch.setattr(computer, "MAX_WAITING", 1)
    client.post("/api/drops", headers=admin_headers, json=SNIPPET)
    r = client.post("/api/drops", headers=admin_headers, json=SNIPPET)
    assert r.status_code == 422 and "reader sync" in r.json()["detail"]


def test_old_delivered_items_are_cleaned_up(client, admin_headers):
    a = client.post("/api/drops", headers=admin_headers, json=SNIPPET).json()["id"]
    client.post(f"/api/drops/{a}/delivered", headers=admin_headers)
    with get_engine().begin() as c:
        c.execute(text("UPDATE drops SET delivered_at = now() - interval '31 days'"))
    client.get("/api/drops", headers=admin_headers)
    with get_engine().begin() as c:
        assert c.execute(text("SELECT count(*) FROM drops")).scalar() == 0


def test_notes_from_the_computer_and_the_conflict_check(client, admin_headers, indexed_book):
    r = client.post("/api/notes", headers=admin_headers, json={"title": "From vim", "markdown": "# Hi", "origin": "computer",
                                                               "book_id": indexed_book})
    assert r.status_code == 201 and r.json()["origin"] == "computer" and r.json()["book_title"] == "Efficient ML"
    note = r.json()
    assert client.post("/api/notes", headers=admin_headers, json={"title": "x", "markdown": "", "book_id": "nope"}).status_code == 404
    ok = client.patch(f"/api/notes/{note['id']}", headers=admin_headers,
                      json={"markdown": "# Edited", "updated_at_was": note["updated_at"]})
    assert ok.status_code == 200
    stale = client.patch(f"/api/notes/{note['id']}", headers=admin_headers,
                         json={"markdown": "# Old base", "updated_at_was": note["updated_at"]})
    assert stale.status_code == 409 and stale.json()["detail"]["updated_at"] == ok.json()["updated_at"]
    assert client.get(f"/api/notes/{note['id']}", headers=admin_headers).json()["markdown"] == "# Edited"


def test_the_agent_sends_to_the_computer_after_confirming(client, admin_headers, indexed_book, groq):
    groq.steps += [call("send_to_computer", {"title": "Pruning code", "text": "prune(model, 0.5)", "kind": "snippet",
                                             "language": "python"}), say("Proposed.")]
    cid = new(client, admin_headers)
    action = next(d for n, d in ask(client, admin_headers, cid, "Send the pruning code to my computer") if n == "action")
    assert action["label"] == "Send to your computer: Pruning code" and action["preview"] == "prune(model, 0.5)"
    assert client.get("/api/drops", headers=admin_headers).json() == []
    client.post(f"/api/conversations/{cid}/actions/{action['id']}", headers=admin_headers, json={"approve": True})
    [drop] = client.get("/api/drops", headers=admin_headers).json()
    assert (drop["kind"], drop["language"], drop["body"]) == ("snippet", "python", "prune(model, 0.5)")


P1, P2 = "proj-00000000-0001", "proj-00000000-0002"


def test_projects_hold_notes_and_sent_items(client, admin_headers, auth_headers):
    assert client.put(f"/api/projects/{P1}", headers=admin_headers, json={"name": "rust-book"}).json() == \
        {"id": P1, "name": "rust-book", "notes": 0}
    client.put(f"/api/projects/{P2}", headers=admin_headers, json={"name": "Thesis"})
    assert client.put(f"/api/projects/{P2}", headers=admin_headers, json={"name": "RUST-book"}).status_code == 409
    assert client.put("/api/projects/bad", headers=admin_headers, json={"name": "x"}).status_code == 422
    assert client.put(f"/api/projects/{P1}", headers=auth_headers, json={"name": "mine"}).status_code == 404  # not theirs

    note = client.post("/api/notes", headers=admin_headers, json={"title": "Ownership", "markdown": "Moves.",
                                                                  "project_id": P1, "origin": "computer"}).json()
    assert (note["project_id"], note["project"]) == (P1, "rust-book")
    assert client.post("/api/notes", headers=auth_headers, json={"title": "x", "markdown": "y", "project_id": P1}).status_code == 404
    moved = client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"project_id": P2}).json()
    assert moved["project"] == "Thesis" and moved["markdown"] == "Moves."
    kept = client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"markdown": "Borrows."}).json()
    assert kept["project_id"] == P2  # not sent: stays
    out = client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"project_id": None}).json()
    assert out["project_id"] is None

    client.post("/api/drops", headers=admin_headers, json={**SNIPPET, "project_id": P1})
    assert client.post("/api/drops", headers=auth_headers, json={**SNIPPET, "project_id": P1}).status_code == 404
    assert client.get("/api/drops", headers=admin_headers).json()[0]["project_id"] == P1
    assert [(p["name"], p["notes"]) for p in client.get("/api/projects", headers=admin_headers).json()] == \
        [("rust-book", 0), ("Thesis", 0)]
    assert client.get("/api/projects", headers=auth_headers).json() == []


def test_deleting_a_project_keeps_its_notes(client, admin_headers):
    client.put(f"/api/projects/{P1}", headers=admin_headers, json={"name": "rust-book"})
    note = client.post("/api/notes", headers=admin_headers, json={"title": "T", "markdown": "M", "project_id": P1}).json()
    assert client.delete(f"/api/projects/{P1}", headers=admin_headers).status_code == 204
    after = client.get(f"/api/notes/{note['id']}", headers=admin_headers).json()
    assert after["project_id"] is None and after["updated_at"] > note["updated_at"]  # the computer moves its file
    assert client.delete(f"/api/projects/{P1}", headers=admin_headers).status_code == 404


def test_the_poll_is_small_and_its_stamp_changes_with_any_note_change(client, admin_headers):
    first = client.get("/api/computer/poll", headers=admin_headers).json()
    assert first == {"drops": [], "projects": [], "notes_stamp": "0:"}
    assert client.get("/api/computer", headers=admin_headers).json()["seen_at"] is not None
    note = client.post("/api/notes", headers=admin_headers, json={"title": "T", "markdown": "M"}).json()
    stamps = [client.get("/api/computer/poll", headers=admin_headers).json()["notes_stamp"]]
    client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"markdown": "N"})
    stamps.append(client.get("/api/computer/poll", headers=admin_headers).json()["notes_stamp"])
    client.put(f"/api/projects/{P1}", headers=admin_headers, json={"name": "p"})
    client.patch(f"/api/notes/{note['id']}", headers=admin_headers, json={"project_id": P1})
    stamps.append(client.get("/api/computer/poll", headers=admin_headers).json()["notes_stamp"])
    client.delete(f"/api/notes/{note['id']}", headers=admin_headers)
    stamps.append(client.get("/api/computer/poll", headers=admin_headers).json()["notes_stamp"])
    assert len(set(stamps)) == 4 and stamps[-1] == "0:"
    assert client.get("/api/computer/poll", headers=admin_headers).json()["projects"] == [{"id": P1, "name": "p", "notes": 0}]


def test_the_agent_saves_and_sends_into_a_project(client, admin_headers, indexed_book, groq):
    client.put(f"/api/projects/{P1}", headers=admin_headers, json={"name": "rust-book"})
    groq.steps += [call("send_to_computer", {"title": "Borrowing", "text": "fn main() {}", "kind": "snippet",
                                             "language": "rust", "project": "rust"}),
                   call("save_note", {"title": "Lifetimes", "markdown": "## Lifetimes", "project": "Rust-Book"}, "c2"),
                   call("list_notes", {"project": "nope"}, "c3"), say("Proposed.")]
    cid = new(client, admin_headers)
    evs = ask(client, admin_headers, cid, "Send this to my rust project and keep a note there")
    actions = [d for n, d in evs if n == "action"]
    assert actions[0]["label"] == "Send to your computer (rust): Borrowing"
    for a in actions:
        assert client.post(f"/api/conversations/{cid}/actions/{a['id']}", headers=admin_headers,
                           json={"approve": True}).json()["content"].startswith("Done")
    assert client.get("/api/drops", headers=admin_headers).json()[0]["project_id"] == P1
    [note] = client.get("/api/notes", headers=admin_headers).json()
    assert note["project"] == "rust-book"
    listed = [m for m in groq.agent_calls[-1]["messages"] if m["role"] == "tool"][-1]["content"]
    assert "No project 'nope'" in listed and "rust-book" in listed


def test_a_drop_can_go_to_the_running_file(client, admin_headers):
    client.post("/api/drops", headers=admin_headers, json={**SNIPPET, "append": True})
    client.post("/api/drops", headers=admin_headers, json={"kind": "text", "body": "a file of its own"})
    assert [d["append"] for d in client.get("/api/computer/poll", headers=admin_headers).json()["drops"]] == [True, False]
