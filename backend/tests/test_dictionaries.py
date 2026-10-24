import gzip
import io
import json
import sqlite3
import struct
import zipfile

import httpx
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app import indexer
from app.db import get_engine
from tests.conftest import add_reader, sign_in
from tests.test_books import info

ENTRIES = [("Haus", "das Gebäude, in dem man wohnt"), ("Wolke", "sichtbare Ansammlung von Wassertröpfchen")]


def tiny_stardict(folder: str = "mini", entries=ENTRIES) -> bytes:
    """A StarDict as a zip: .ifo, .idx, .dict (plain text definitions) and a .syn."""
    data, idx = b"", b""
    for word, definition in entries:
        raw = definition.encode()
        idx += word.encode() + b"\0" + struct.pack(">II", len(data), len(raw))
        data += raw
    ifo = (f"StarDict's dict ifo file\nversion=2.4.2\nbookname=Mini Wörterbuch\nwordcount={len(entries)}\n"
           f"idxfilesize={len(idx)}\nsametypesequence=m\n")
    syn = b"Haeuser\0" + struct.pack(">I", 0)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"{folder}/mini.ifo", ifo)
        z.writestr(f"{folder}/mini.idx", idx)
        z.writestr(f"{folder}/mini.dict", data)
        z.writestr(f"{folder}/mini.syn", syn)
    return buf.getvalue()


def upload_stardict(client, headers, data: bytes, **meta) -> str:
    body = {"name": "Mini", "from_lang": "de", "to_lang": "de", **meta, "source": info(data, "application/zip")}
    r = client.post("/api/admin/dictionaries/upload", headers=headers, json=body)
    assert r.status_code == 200, r.text
    assert httpx.put(r.json()["uploads"]["source"], content=data, headers={"Content-Type": "application/zip"}).status_code == 200
    assert client.post(f"/api/admin/dictionaries/{r.json()['id']}/convert", headers=headers).status_code == 200
    return r.json()["id"]


def run_queue():
    db = sessionmaker(bind=get_engine())()
    while (job := indexer.claim_dict(db)) is not None:
        indexer.run_dict_job(db, job)
    db.close()


def keys(bucket):
    return sorted(o["Key"] for o in bucket.list_objects_v2(Bucket="test-library").get("Contents", []))


def test_upload_is_converted_on_the_server(client, admin_headers, bucket, tmp_path):
    dict_id = upload_stardict(client, admin_headers, tiny_stardict(), visibility="everyone")
    assert client.get("/api/library", headers=admin_headers).json()["dictionaries"] == []  # not until converted
    jobs = client.get("/api/admin/dict-jobs", headers=admin_headers).json()
    assert [(j["dict_id"], j["status"], j["name"]) for j in jobs] == [(dict_id, "queued", "Mini")]
    run_queue()
    [d] = client.get("/api/library", headers=admin_headers).json()["dictionaries"]
    assert d["id"] == dict_id and d["entry_count"] == 2 and set(d["files"]) == {"sqlite", "jsonl"}
    assert not any("source" in k for k in keys(bucket))  # the upload is gone once converted
    # the packages answer lookups
    link = client.get(f"/api/dictionaries/{dict_id}/download?kind=jsonl", headers=admin_headers).json()["url"]
    lines = gzip.decompress(httpx.get(link).content).decode().splitlines()
    assert json.loads(lines[1]) == [0, "Haus", "das Gebäude, in dem man wohnt"] and json.loads(lines[-1]) == ["Haeuser", 0]
    link = client.get(f"/api/dictionaries/{dict_id}/download?kind=sqlite", headers=admin_headers).json()["url"]
    with zipfile.ZipFile(io.BytesIO(httpx.get(link).content)) as z:
        z.extract(f"{dict_id}SQLite.db", tmp_path)
    con = sqlite3.connect(tmp_path / f"{dict_id}SQLite.db")
    assert con.execute("SELECT headword FROM entries WHERE key = 'wolke'").fetchone() == ("Wolke",)
    assert client.get(f"/api/dictionaries/{dict_id}/download?kind=source", headers=admin_headers).status_code == 404


def test_a_new_upload_replaces_the_packages(client, admin_headers, bucket):
    dict_id = upload_stardict(client, admin_headers, tiny_stardict(), visibility="everyone")
    run_queue()
    before = keys(bucket)
    upload_stardict(client, admin_headers, tiny_stardict(entries=ENTRIES + [("Zug", "Bahn")]), id=dict_id, visibility="everyone")
    run_queue()
    [d] = client.get("/api/library", headers=admin_headers).json()["dictionaries"]
    assert d["entry_count"] == 3
    assert not set(before) & set(keys(bucket))  # old packages deleted


def test_broken_upload_fails_with_the_reason(client, admin_headers, bucket):
    upload_stardict(client, admin_headers, b"PK\x05\x06" + b"\0" * 18)  # an empty zip
    run_queue()
    [job] = client.get("/api/admin/dict-jobs", headers=admin_headers).json()
    assert job["status"] == "failed" and ".ifo" in job["error"]


def test_only_admins_upload_and_edit(client, auth_headers, bucket):
    body = {"name": "x", "from_lang": "de", "to_lang": "de", "source": info(b"x", "application/zip")}
    assert client.post("/api/admin/dictionaries/upload", headers=auth_headers, json=body).status_code == 403
    assert client.put("/api/admin/dictionaries/x", headers=auth_headers, json={"visibility": "private"}).status_code == 403


def test_private_dictionaries_are_only_for_the_uploader(client, admin_headers, auth_headers, bucket):
    private = upload_stardict(client, admin_headers, tiny_stardict("a"), name="Duden")  # private by default
    shared = upload_stardict(client, admin_headers, tiny_stardict("b"), name="Ding", visibility="everyone")
    run_queue()
    mine = client.get("/api/library", headers=auth_headers).json()["dictionaries"]
    assert [d["id"] for d in mine] == [shared] and mine[0]["can_change"] is False
    assert client.get(f"/api/dictionaries/{private}/download?kind=jsonl", headers=auth_headers).status_code == 404
    assert {d["id"] for d in client.get("/api/library", headers=admin_headers).json()["dictionaries"]} == {private, shared}
    # sharing it later
    client.put(f"/api/admin/dictionaries/{private}", headers=admin_headers, json={"visibility": "everyone", "name": "Duden 2"})
    names = {d["name"] for d in client.get("/api/library", headers=auth_headers).json()["dictionaries"]}
    assert names == {"Duden 2", "Ding"}


def test_hiding_an_older_dictionary_makes_the_admin_its_owner(client, admin_headers, auth_headers, sent_codes, bucket):
    dict_id = upload_stardict(client, admin_headers, tiny_stardict(), visibility="everyone")
    run_queue()
    with get_engine().begin() as c:  # added before uploads were recorded
        c.execute(text("UPDATE dictionaries SET uploaded_by = NULL"))
    client.put(f"/api/admin/dictionaries/{dict_id}", headers=admin_headers, json={"visibility": "private"})
    assert client.get("/api/library", headers=auth_headers).json()["dictionaries"] == []
    add_reader("other-admin@example.com", "Other", is_admin=True)
    other = sign_in(client, sent_codes, "other-admin@example.com")
    assert len(client.get("/api/library", headers=other).json()["dictionaries"]) == 1  # admins see everything


def test_settings_keep_the_parts_not_sent(client, auth_headers):
    prefs = {"disabled": ["duden"], "order": {"de": ["ding", "duden"]}}
    client.put("/api/settings", headers=auth_headers, json={"dictionaries": prefs})
    r = client.put("/api/settings", headers=auth_headers, json={"reading_goal": {"enabled": True, "minutes": 15}})
    assert r.json()["dictionaries"] == prefs and r.json()["reading_goal"]["minutes"] == 15
    client.put("/api/settings", headers=auth_headers, json={"dictionaries": {"disabled": []}})
    s = client.get("/api/settings", headers=auth_headers).json()
    assert s["reading_goal"]["enabled"] is True and s["dictionaries"] == {"disabled": [], "order": {}}
