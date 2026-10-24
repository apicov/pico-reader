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
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from moto.server import ThreadedMotoServer
from sqlalchemy import text

from app import r2
from app.config import get_settings
from app.db import get_engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def schema():
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")


@pytest.fixture(autouse=True)
def clean_tables(schema):
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE readers, login_codes, books, dictionaries, translations, reading_state, book_index, book_chunks, annotations, conversations, messages, reading_sessions, lookups, reader_settings, known_words, review_cards, chat_actions, shelf, llm_usage, book_events, index_jobs, profiles, reviews, posts, comments, likes, lists CASCADE"))


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
