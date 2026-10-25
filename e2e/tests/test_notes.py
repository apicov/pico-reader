import json

from conftest import WEB, script_ai, until

NOTE = "## Figuren\n\n- **Janna-Berta**, 14\n\n```mermaid\nflowchart LR\n  J[\"Janna-Berta\"] --> U[\"Uli\"]\n```\n"


def call(name, args):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def test_the_chat_proposes_a_note_and_after_confirming_it_is_on_the_notes_page(page, api):
    script_ai(call("save_note", {"title": "Die Wolke: Figuren", "markdown": NOTE, "book": "Die Wolke"}),
              {"role": "assistant", "content": "I proposed a note with the characters."})
    page.goto(f"{WEB}/#/ask")
    page.get_by_placeholder("Ask about your books…").fill("Make me a note of the characters")
    page.get_by_label("Send").click()
    page.get_by_text("Save note: Die Wolke: Figuren").wait_for(timeout=20_000)
    page.get_by_role("button", name="Show the note").click()
    page.locator(".diagram svg").first.wait_for(timeout=20_000)  # the preview draws the diagram
    mine = lambda: [n for n in api.get("/api/notes").json() if n["title"].startswith("Die Wolke: Figuren")]
    assert mine() == []  # nothing saved before confirming
    page.get_by_role("button", name="Confirm").click()
    page.get_by_text("Done ✓").wait_for()
    [note] = until(mine, what="the note on the server")
    assert note["book_title"] == "Die Wolke (Probe)"

    page.goto(f"{WEB}/#/notes")
    page.get_by_text("Die Wolke: Figuren").click()
    page.locator(".diagram svg").first.wait_for(timeout=20_000)
    page.get_by_label("Note actions").click()
    page.get_by_role("menuitem", name="Edit").click()
    page.get_by_label("Title").fill("Die Wolke: Figuren und Orte")
    page.get_by_role("button", name="Save").click()
    page.get_by_role("heading", name="Die Wolke: Figuren und Orte").wait_for()
    assert api.get(f"/api/notes/{note['id']}").json()["title"] == "Die Wolke: Figuren und Orte"
