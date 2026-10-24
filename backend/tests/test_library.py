import hashlib

import httpx

PDF = b"%PDF-1.4 fake book"
COVER = b"\x89PNG fake cover"


def info(data: bytes, content_type: str) -> dict:
    return {"size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "content_type": content_type}


def upload(client, headers, files: dict[str, tuple[bytes, str]], **meta):
    body = {"title": "Der Prozess", "author": "Franz Kafka", "language": "de", **meta,
            "files": {kind: info(data, ct) for kind, (data, ct) in files.items()}}
    r = client.post("/api/admin/books", headers=headers, json=body)
    assert r.status_code == 200, r.text
    for kind, url in r.json()["uploads"].items():
        data, ct = files[kind]
        assert httpx.put(url, content=data, headers={"Content-Type": ct}).status_code == 200
    return r.json()["id"]


def test_book_is_listed_only_after_commit(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (PDF, "application/pdf"), "cover": (COVER, "image/png")})
    assert book_id.startswith("der-prozess-")
    assert client.get("/api/library", headers=admin_headers).json()["books"] == []

    assert client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers).status_code == 200
    books = client.get("/api/library", headers=admin_headers).json()["books"]
    assert [b["id"] for b in books] == [book_id]
    assert books[0]["formats"] == {"pdf": {"size": len(PDF), "sha256": hashlib.sha256(PDF).hexdigest()}}
    assert httpx.get(books[0]["cover"]["url"]).content == COVER
    assert "key" not in books[0]["formats"]["pdf"]


def test_commit_refuses_a_missing_upload(client, admin_headers, bucket):
    r = client.post("/api/admin/books", headers=admin_headers, json={
        "title": "Ficciones", "language": "es", "files": {"epub": info(b"epub", "application/epub+zip")}})
    r = client.post(f"/api/admin/books/{r.json()['id']}/commit", headers=admin_headers)
    assert r.status_code == 409
    assert r.json()["detail"]["missing"] == ["epub"]


def test_download_link_serves_the_file(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (PDF, "application/pdf")})
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)
    r = client.get(f"/api/books/{book_id}/download", params={"kind": "pdf"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "private, max-age=300"
    assert httpx.get(r.json()["url"]).content == PDF
    assert client.get(f"/api/books/{book_id}/download", params={"kind": "epub"},
                      headers=admin_headers).status_code == 404


def test_adding_a_format_keeps_the_book_visible_and_replaces_old_files(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (PDF, "application/pdf")})
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)

    new_pdf = PDF + b" second edition"
    upload(client, admin_headers, {"pdf": (new_pdf, "application/pdf"), "reflow": (b"zip", "application/zip")},
           id=book_id)
    assert len(client.get("/api/library", headers=admin_headers).json()["books"]) == 1  # still listed
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)

    formats = client.get("/api/library", headers=admin_headers).json()["books"][0]["formats"]
    assert set(formats) == {"pdf", "reflow"}
    assert formats["pdf"]["sha256"] == hashlib.sha256(new_pdf).hexdigest()
    keys = [o["Key"] for o in bucket.list_objects_v2(Bucket="test-library")["Contents"]]
    assert len(keys) == 2  # the first PDF is gone


def test_library_etag_gives_304(client, admin_headers, bucket):
    r = client.get("/api/library", headers=admin_headers)
    etag = r.headers["etag"]
    assert client.get("/api/library", headers={**admin_headers, "If-None-Match": etag}).status_code == 304


def test_delete_removes_row_and_files(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (PDF, "application/pdf")})
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)
    assert client.delete(f"/api/admin/books/{book_id}", headers=admin_headers).status_code == 204
    assert bucket.list_objects_v2(Bucket="test-library").get("KeyCount") == 0


def test_dictionary_upload_and_download(client, admin_headers, bucket):
    data = b"SQLite format 3\x00"
    r = client.post("/api/admin/dictionaries", headers=admin_headers, json={
        "name": "Duden", "from_lang": "de", "to_lang": "de", "entry_count": 118901,
        "files": {"sqlite": info(data, "application/vnd.sqlite3")}})
    dict_id = r.json()["id"]
    httpx.put(r.json()["uploads"]["sqlite"], content=data, headers={"Content-Type": "application/vnd.sqlite3"})
    client.post(f"/api/admin/dictionaries/{dict_id}/commit", headers=admin_headers)
    [d] = client.get("/api/library", headers=admin_headers).json()["dictionaries"]
    assert (d["from_lang"], d["entry_count"]) == ("de", 118901)
    link = client.get(f"/api/dictionaries/{dict_id}/download", params={"kind": "sqlite"}, headers=admin_headers)
    assert httpx.get(link.json()["url"]).content == data


def test_rejects_wrong_content_type(client, admin_headers, bucket):
    r = client.post("/api/admin/books", headers=admin_headers, json={
        "title": "x", "language": "de", "files": {"pdf": info(b"x", "text/plain")}})
    assert r.status_code == 422
