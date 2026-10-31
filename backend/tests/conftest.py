"""Tests run against a real Postgres (JSONB, ON CONFLICT) and a moto S3 server standing in for R2.
Start the database with:

    podman run -d --name pico-reader-db -e POSTGRES_USER=reader -e POSTGRES_PASSWORD=reader \
        -e POSTGRES_DB=reader -p 127.0.0.1:5440:5432 docker.io/pgvector/pgvector:pg16
    podman exec pico-reader-db createdb -U reader reader_test

The schema is dropped and rebuilt by alembic once per test session.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://reader:reader@127.0.0.1:5440/reader_test")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.pop("CLOUDFLARE_EMAIL_API_TOKEN", None)  # dev mode: codes are logged, not sent
for var in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
    os.environ[var] = "test"
os.environ["R2_BUCKET"] = "test-library"

import boto3
import httpx
import numpy as np
import pytest
from alembic import command
from alembic.config import Config
from fastapi import routing
from fastapi.encoders import jsonable_encoder
from fastapi.testclient import TestClient
from moto.server import ThreadedMotoServer
from sqlalchemy import text

from app import llm, r2
from app.config import get_settings
from app.db import get_engine
from app.main import app
from pico_core import embed
from tests.helpers import GOOD, PASSAGES, FakeAgentAI, fake_vector, upload


@pytest.fixture(scope="session", autouse=True)
def schema():
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")


def _category_seed():
    import importlib.util
    path = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions", "0014_categories.py")
    spec = importlib.util.spec_from_file_location("categories_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.seed


@pytest.fixture(autouse=True)
def clean_tables(schema):
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE categories RESTART IDENTITY CASCADE"))
        _category_seed()(conn)
        # every table but alembic's own and the categories (seeded again above): a new table is emptied too
        tables = conn.execute(text("""SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                                      AND tablename NOT IN ('alembic_version', 'categories')""")).scalars().all()
        conn.execute(text(f"TRUNCATE {', '.join(tables)} CASCADE"))


def _dropped(raw, out, at="") -> list[str]:
    """Where `out` (the response) lacks a key `raw` (what the route returned) had."""
    if isinstance(raw, dict) and isinstance(out, dict):
        return [f"{at}.{k}" for k in raw if k not in out] + \
            [d for k in raw if k in out for d in _dropped(raw[k], out[k], f"{at}.{k}")]
    if isinstance(raw, list) and isinstance(out, list):
        return [d for i, (r, o) in enumerate(zip(raw, out, strict=True)) for d in _dropped(r, o, f"{at}[{i}]")]
    return []


@pytest.fixture(autouse=True)
def responses_keep_every_field(monkeypatch):
    """A route's response model must describe everything it returns: a field it leaves out would silently not
    reach the app."""
    serialize = routing.serialize_response

    async def checked(*, field=None, response_content, **kwargs):
        out = await serialize(field=field, response_content=response_content, **kwargs)
        if field is not None:
            dropped = _dropped(jsonable_encoder(response_content), out)
            assert not dropped, f"the response model drops {', '.join(dropped)}"
        return out

    monkeypatch.setattr(routing, "serialize_response", checked)


@pytest.fixture(scope="session")
def s3_server():
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0)
    server.start()
    host, port = server.get_host_and_port()
    yield f"http://{host}:{port}"
    server.stop()


@pytest.fixture
def bucket(s3_server, monkeypatch):
    """An empty fake R2 bucket; returns a boto3 client for checking what's in it."""
    monkeypatch.setenv("R2_ENDPOINT", s3_server)
    get_settings.cache_clear()
    r2.get_client.cache_clear()
    client = boto3.client("s3", endpoint_url=s3_server, aws_access_key_id="test", aws_secret_access_key="test",
                          region_name="us-east-1")
    if not any(b["Name"] == "test-library" for b in client.list_buckets()["Buckets"]):
        client.create_bucket(Bucket="test-library")
    for obj in client.list_objects_v2(Bucket="test-library").get("Contents", []):
        client.delete_object(Bucket="test-library", Key=obj["Key"])
    yield client
    get_settings.cache_clear()
    r2.get_client.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)


def add_reader(email="me@example.com", name="Me", is_admin=False):
    with get_engine().begin() as conn:
        conn.execute(text("INSERT INTO readers (email, name, is_admin) VALUES (:e, :n, :a)"),
                     {"e": email, "n": name, "a": is_admin})


@pytest.fixture
def sent_codes(monkeypatch):
    """Captures the codes that would have been emailed."""
    codes: dict[str, str] = {}
    from app import email_service
    monkeypatch.setattr(email_service, "send_verification_code", lambda email, code: codes.__setitem__(email, code))
    return codes


def sign_in(client, codes, email) -> dict[str, str]:
    client.post("/api/auth/send-code", json={"email": email})
    token = client.post("/api/auth/verify-code", json={"email": email, "code": codes[email]}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers(client, sent_codes):
    add_reader()
    return sign_in(client, sent_codes, "me@example.com")


@pytest.fixture
def admin_headers(client, sent_codes):
    add_reader("boss@example.com", "Boss", is_admin=True)
    return sign_in(client, sent_codes, "boss@example.com")


# --- fakes many test modules use: deterministic embeddings, the AI ---

@pytest.fixture
def agent_ai(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    fake = FakeAgentAI()
    monkeypatch.setattr(llm.httpx, "post", fake.post)
    yield fake
    get_settings.cache_clear()

@pytest.fixture(autouse=True)
def fake_embed(monkeypatch):
    monkeypatch.setattr(embed, "embed", lambda texts, kind="passage", batch=32: np.vstack([fake_vector(t) for t in texts]))

@pytest.fixture
def indexed_book(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (b"%PDF-1.4 x", "application/pdf")}, title="Efficient ML", language="en")
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)
    r = client.post(f"/api/admin/books/{book_id}/index/start", headers=admin_headers,
                    json={"format": "reflow", "sha256": "a" * 64, "model": embed.MODEL})
    assert r.status_code == 200, r.text
    chunks = [{"seq": i, "location": f"c{i}:0.0000", "progress": i / 3, "heading": h, "text": t,
               "embedding": fake_vector(t).tolist()} for i, (h, t) in enumerate(PASSAGES)]
    assert client.post(f"/api/admin/books/{book_id}/index/chunks", headers=admin_headers, json=chunks).json() == {"added": 3}
    return book_id

@pytest.fixture(autouse=True)
def fresh_query_cache():
    from app import search_service as search
    search._translated.cache_clear()

@pytest.fixture
def groq(monkeypatch):
    """A fake Groq: replies in turn with the queued contents (dicts become JSON); records the requests."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()
    calls, replies = [], []

    def post(url, json=None, headers=None, timeout=None):
        calls.append(json)
        reply = replies.pop(0) if replies else GOOD
        if isinstance(reply, httpx.Response):
            return reply
        content = reply if isinstance(reply, str) else __import__("json").dumps(reply)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}], "model": json["model"],
                                         "usage": {"prompt_tokens": 120, "completion_tokens": 30}})

    monkeypatch.setattr(llm.httpx, "post", post)
    yield calls, replies
    get_settings.cache_clear()
