"""Dictionaries: who sees which (everyone, or only the uploader; admins see all), StarDict uploads from the app,
and their conversion into the packages devices install (run by the indexer service)."""

import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, r2, stardict
from app.auth import Reader

MAX_SOURCE_BYTES = 300_000_000  # a whole StarDict is read into memory while converting (the server has 2 GB)
PACKAGE_TYPES = {"sqlite": "application/zip", "jsonl": "application/gzip", "res": "application/zip"}


def visible(alias: str = "d") -> str:
    """SQL: the dictionaries the reader (:e, :admin) may see and download."""
    return f"({alias}.visibility = 'everyone' OR {alias}.uploaded_by = :e OR :admin)"


def check_visible(db: Session, reader: Reader, dict_id: str) -> None:
    found = db.execute(text(f"SELECT 1 FROM dictionaries d WHERE d.id = :id AND {visible()}"),
                       {"id": dict_id, "e": reader.email, "admin": reader.is_admin}).fetchone()
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


def edit(db: Session, admin: Reader, dict_id: str, changes: dict) -> None:
    row = db.execute(text("SELECT uploaded_by FROM dictionaries WHERE id = :id"), {"id": dict_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if changes.get("visibility") == "private" and row.uploaded_by is None:
        changes["uploaded_by"] = admin.email  # "only the uploader" of an older dictionary: the admin who hid it
    if changes:
        sets = ", ".join(f"{k} = :{k}" for k in changes)
        db.execute(text(f"UPDATE dictionaries SET {sets}, updated_at = now() WHERE id = :id"), {**changes, "id": dict_id})
        db.commit()


# --- uploads from the app: one StarDict zip ("source"), converted on the server ---

def start_upload(db: Session, admin: Reader, name: str, from_lang: str, to_lang: str, visibility: str,
                 source: assets.FileInfo, dict_id: str | None = None) -> dict:
    if source.size > MAX_SOURCE_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Dictionaries up to 300 MB can be converted")
    dict_id = assets.check_id(dict_id) if dict_id else assets.new_id(name)
    pending, links = assets.plan_uploads("dictionaries", dict_id, assets.DICT_KINDS, {"source": source})
    db.execute(text("""
        INSERT INTO dictionaries (id, name, from_lang, to_lang, pending, visibility, uploaded_by)
        VALUES (:id, :n, :f, :t, CAST(:p AS jsonb), :v, :u)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, from_lang = EXCLUDED.from_lang, to_lang = EXCLUDED.to_lang,
            pending = EXCLUDED.pending, visibility = EXCLUDED.visibility, updated_at = now()
    """), {"id": dict_id, "n": name, "f": from_lang, "t": to_lang, "p": json.dumps(pending), "v": visibility,
           "u": admin.email})
    db.commit()
    return {"id": dict_id, "uploads": links}


def commit_source(db: Session, admin: Reader, dict_id: str) -> int:
    """The source zip is in R2: keep it with the dictionary and queue its conversion. The dictionary stays
    unlisted until converted (an update of a listed one stays listed with its old packages meanwhile)."""
    row = db.execute(text("SELECT files, pending FROM dictionaries WHERE id = :id FOR UPDATE"), {"id": dict_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    src = (row.pending or {}).get("source")
    if src is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to commit")
    if r2.object_size(src["key"]) != src["size"]:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, {"message": "Upload incomplete", "missing": ["source"]})
    old = (row.files or {}).get("source")
    db.execute(text("""UPDATE dictionaries SET files = files || jsonb_build_object('source', CAST(:s AS jsonb)),
                       pending = '{}', updated_at = now() WHERE id = :id"""), {"s": json.dumps(src), "id": dict_id})
    job = db.execute(text("INSERT INTO dict_jobs (dict_id, requested_by) VALUES (:d, :r) RETURNING id"),
                     {"d": dict_id, "r": admin.email}).scalar()
    db.commit()
    if old and old["key"] != src["key"]:
        r2.delete_key(old["key"])
    return job


def jobs(db: Session) -> list[dict]:
    rows = db.execute(text("""
        SELECT j.id, j.dict_id, coalesce(d.name, '') AS name, j.status, j.error, j.created_at, j.finished_at
        FROM dict_jobs j LEFT JOIN dictionaries d ON d.id = j.dict_id
        WHERE j.status IN ('queued', 'running') OR (j.status = 'failed' AND j.finished_at > now() - interval '7 days')
        ORDER BY j.id"""))
    return [dict(r._mapping) for r in rows]


# --- the conversion (indexer service) ---

def _stardict_folder(root: Path) -> Path:
    ifos = sorted(root.rglob("*.ifo"))
    if not ifos:
        raise ValueError("No .ifo file in the upload: is it a StarDict dictionary?")
    return ifos[0].parent


def convert(db: Session, dict_id: str) -> int:
    """Turn the uploaded StarDict zip into the sqlite/jsonl/res packages; returns the number of entries."""
    row = db.execute(text("SELECT name, files FROM dictionaries WHERE id = :id"), {"id": dict_id}).fetchone()
    src = (row.files or {}).get("source") if row else None
    if src is None:
        raise RuntimeError("The dictionary has no uploaded StarDict any more")
    bucket = r2.get_settings().r2_bucket
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / "source.zip"
        r2.get_client().download_file(bucket, src["key"], str(zip_path))
        unpacked = Path(tmp) / "src"
        try:
            with zipfile.ZipFile(zip_path) as z:
                for member in z.namelist():  # no paths outside the folder
                    if member.startswith("/") or ".." in Path(member).parts:
                        raise ValueError(f"Unsafe path in the zip: {member}")
                z.extractall(unpacked)
        except zipfile.BadZipFile:
            raise ValueError("The upload is not a zip file")
        d = stardict.read(_stardict_folder(unpacked))
        if not d.entries:
            raise ValueError("The dictionary has no entries")
        out = Path(tmp) / "out"
        out.mkdir()
        packages = {}
        for kind, path in stardict.write_packages(d, dict_id, out).items():
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            info = assets.FileInfo(size=path.stat().st_size, sha256=sha, content_type=PACKAGE_TYPES[kind])
            pending, _ = assets.plan_uploads("dictionaries", dict_id, assets.DICT_KINDS, {kind: info})
            r2.get_client().upload_file(str(path), bucket, pending[kind]["key"], ExtraArgs={"ContentType": info.content_type})
            packages[kind] = pending[kind]
    old = row.files
    files = {k: v for k, v in old.items() if k not in ("source", "sqlite", "jsonl", "res")} | packages
    db.execute(text("""UPDATE dictionaries SET files = CAST(:f AS jsonb), status = 'ready', entry_count = :n,
                       name = CASE WHEN name = '' THEN :name ELSE name END, updated_at = now() WHERE id = :id"""),
               {"f": json.dumps(files), "n": len(d.entries), "name": d.name, "id": dict_id})
    db.commit()
    for kind, f in old.items():  # the source zip and replaced packages
        if kind == "source" or (kind in packages and f["key"] != packages[kind]["key"]):
            r2.delete_key(f["key"])
    return len(d.entries)
