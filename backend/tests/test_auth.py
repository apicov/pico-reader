from sqlalchemy import text

from app.db import get_engine
from tests.conftest import add_reader


def test_unknown_email_gets_the_same_reply_and_no_code(client, sent_codes):
    r = client.post("/api/auth/send-code", json={"email": "stranger@example.com"})
    assert r.status_code == 200
    assert sent_codes == {}


def test_code_signs_in_and_is_single_use(client, sent_codes):
    add_reader()
    client.post("/api/auth/send-code", json={"email": "Me@Example.com"})
    code = sent_codes["me@example.com"]
    r = client.post("/api/auth/verify-code", json={"email": "me@example.com", "code": code})
    assert r.status_code == 200
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "me@example.com"
    assert client.post("/api/auth/verify-code", json={"email": "me@example.com", "code": code}).status_code == 401


def test_removed_reader_is_locked_out_at_once(client, auth_headers):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE readers SET active = false"))
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 401


def test_admin_routes_need_an_admin(client, auth_headers):
    r = client.post("/api/admin/books", headers=auth_headers,
                    json={"title": "x", "language": "de", "files": {}})
    assert r.status_code == 403
