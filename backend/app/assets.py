"""What books and dictionaries share: files in R2 under `<table>/<id>/`, uploaded by the desktop tool
through signed PUT links (pending), then committed once the server sees every file in the bucket."""

import json
import logging
import re
import secrets
import unicodedata
from dataclasses import dataclass

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import r2
from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Kind:
    content_types: tuple[str, ...]
    ext: str  # '' = taken from the content type (covers)


BOOK_KINDS = {
    "pdf": Kind(("application/pdf",), "pdf"),
    "epub": Kind(("application/epub+zip",), "epub"),
    "mdbook": Kind(("application/zip",), "zip"),  # see tools/ for the bundle layout
    "cover": Kind(("image/jpeg", "image/png", "image/webp"), ""),
}
DICT_KINDS = {
    "sqlite": Kind(("application/vnd.sqlite3",), "sqlite"),  # opened as is on Android
    "jsonl": Kind(("application/gzip",), "jsonl.gz"),  # imported into IndexedDB on the web
    "res": Kind(("application/zip",), "zip"),  # images the definitions point at
}
_IMAGE_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class FileInfo(BaseModel):
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    content_type: str


def new_id(title: str) -> str:
    """A readable, URL-safe id: slug of the title plus a random suffix (titles repeat across editions)."""
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")[:40].strip("-") or "item"
    return f"{slug}-{secrets.token_hex(3)}"


def check_id(asset_id: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", asset_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ids are lowercase letters, digits and dashes")
    return asset_id


def plan_uploads(table: str, asset_id: str, kinds: dict[str, Kind],
                 files: dict[str, FileInfo]) -> tuple[dict[str, dict], dict[str, str]]:
    """The pending entries for `files` and a signed PUT link for each."""
    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No files")
    pending, links = {}, {}
    for kind, info in files.items():
        spec = kinds.get(kind)
        if spec is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown file kind {kind!r}")
        if info.content_type not in spec.content_types:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"{kind} must be {' or '.join(spec.content_types)}")
        # The hash is in the key, so a replaced file never hits a stale cache (R2 or the device)
        key = f"{table}/{asset_id}/{kind}-{info.sha256[:12]}.{spec.ext or _IMAGE_EXT[info.content_type]}"
        pending[kind] = {"key": key, **info.model_dump()}
        links[kind] = r2.upload_url(key, info.content_type)
    return pending, links


def commit(db: Session, table: str, asset_id: str) -> dict:
    """Move the uploaded pending files into `files`. 409 lists what's missing in R2."""
    row = db.execute(text(f"SELECT files, pending FROM {table} WHERE id = :id FOR UPDATE"), {"id": asset_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if not row.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing to commit")
    missing = [kind for kind, f in row.pending.items() if r2.object_size(f["key"]) != f["size"]]
    if missing:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, {"message": "Upload incomplete", "missing": missing})
    replaced = [f["key"] for kind, f in row.files.items() if kind in row.pending and f["key"] != row.pending[kind]["key"]]
    files = {**row.files, **row.pending}
    db.execute(text(f"""UPDATE {table} SET files = CAST(:files AS jsonb), pending = '{{}}', status = 'ready',
                        updated_at = now() WHERE id = :id"""), {"files": json.dumps(files), "id": asset_id})
    db.commit()
    for key in replaced:
        r2.delete_key(key)
    return files


def delete(db: Session, table: str, asset_id: str) -> None:
    if db.execute(text(f"DELETE FROM {table} WHERE id = :id"), {"id": asset_id}).rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    db.commit()
    r2.delete_prefix(f"{table}/{asset_id}/")


def public_files(files: dict) -> dict:
    """What the app needs to know about each file (the R2 key stays on the server)."""
    return {kind: {"size": f["size"], "sha256": f["sha256"]} for kind, f in files.items()}


def download(db: Session, table: str, asset_id: str, kind: str) -> dict:
    row = db.execute(text(f"SELECT files FROM {table} WHERE id = :id AND status = 'ready'"), {"id": asset_id}).fetchone()
    f = row.files.get(kind) if row else None
    if f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    try:
        url = r2.download_url(f["key"])
    except Exception:
        logger.exception("R2 signed URL failed for %s", f["key"])
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Storage unavailable")
    return {"url": url, "expiresIn": get_settings().download_url_seconds, "size": f["size"], "sha256": f["sha256"]}
