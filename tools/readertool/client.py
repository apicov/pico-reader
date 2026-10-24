"""The backend's admin API, signed in as an admin reader. The token is kept in ~/.config/pico-reader/tool.json."""

import hashlib
import json
import os
from pathlib import Path

import requests

CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "pico-reader" / "tool.json"
DEFAULT_SERVER = "https://books.apicov.xyz"


class ToolError(Exception):
    pass


def load_config() -> dict:
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def save_config(config: dict) -> None:
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.touch(mode=0o600)
    CONFIG.write_text(json.dumps(config, indent=2))


def send_code(server: str, email: str) -> None:
    _check(requests.post(f"{server}/api/auth/send-code", json={"email": email}, timeout=30))


def login(server: str, email: str, code: str) -> None:
    r = requests.post(f"{server}/api/auth/verify-code", json={"email": email, "code": code}, timeout=30)
    _check(r)
    reader = r.json()["reader"]
    if not reader["is_admin"]:
        raise ToolError(f"{email} is not an admin; only admins can add books")
    save_config({"server": server, "token": r.json()["access_token"], "email": email})


class Api:
    def __init__(self):
        config = load_config()
        if "token" not in config:
            raise ToolError("Not signed in: run `reader login <email>` first")
        self.server = config["server"]
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {config['token']}"

    def get(self, path: str, **kw):
        return _check(self.session.get(self.server + path, timeout=60, **kw)).json()

    def post(self, path: str, body: dict | None = None):
        return _check(self.session.post(self.server + path, json=body, timeout=60)).json()

    def delete(self, path: str) -> None:
        _check(self.session.delete(self.server + path, timeout=60))

    def upload(self, collection: str, meta: dict, files: dict[str, tuple[Path, str]]) -> str:
        """Create or update a book/dictionary with `files` ({kind: (path, content type)}); returns its id."""
        body = {**meta, "files": {kind: file_info(path, ct) for kind, (path, ct) in files.items()}}
        res = self.post(f"/api/admin/{collection}", body)
        for kind, url in res["uploads"].items():
            path, ct = files[kind]
            print(f"  uploading {kind} ({path.stat().st_size / 1e6:.1f} MB)")
            with path.open("rb") as f:
                put = requests.put(url, data=f, headers={"Content-Type": ct}, timeout=3600)
            if not put.ok:
                raise ToolError(f"Upload of {kind} failed: HTTP {put.status_code} {put.text[:200]}")
        self.post(f"/api/admin/{collection}/{res['id']}/commit")
        return res["id"]


def file_info(path: Path, content_type: str) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return {"size": path.stat().st_size, "sha256": digest.hexdigest(), "content_type": content_type}


def _check(r: requests.Response) -> requests.Response:
    if not r.ok:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = r.text[:200]
        raise ToolError(f"HTTP {r.status_code}: {detail}")
    return r
