"""Projects: folders on this computer linked to the reader's projects in the app (`reader project add`), each with its
own notes/ and inbox/. Which folder is which project is kept in projects.json next to the tool's config."""

import json
import uuid
from pathlib import Path

from readertool.client import CONFIG, ToolError

PROJECTS = CONFIG.parent / "projects.json"  # project id → {name, path}: the folders `reader project add` linked


def load_projects(path: Path = PROJECTS) -> dict[str, dict]:
    return json.loads(path.read_text()) if path.exists() else {}


def save_projects(projects: dict[str, dict], path: Path = PROJECTS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(projects, indent=2))


def project_add(api, path: Path, name: str | None = None, projects_path: Path = PROJECTS) -> dict:
    """Links `path` to a project in the app (the one of that name, or a new one); the running sync picks it up."""
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise ToolError(f"{path} isn't a folder")
    projects = load_projects(projects_path)
    linked = next((pid for pid, p in projects.items() if Path(p["path"]) == path), None)
    name = " ".join((name or path.name).split())[:60]
    existing = {p["name"].lower(): p for p in api.get("/api/projects")}
    if linked and name.lower() in existing and existing[name.lower()]["id"] != linked:
        raise ToolError(f"You have another project called {name!r} already")
    if not linked and name.lower() in existing:  # the app's project of that name (made on another computer)
        saved = existing[name.lower()]
    else:  # a new project, or this folder's under a new name
        saved = api.put(f"/api/projects/{linked or f'proj-{uuid.uuid4()}'}", {"name": name})
    pid = saved["id"]
    projects[pid] = {"name": saved["name"], "path": str(path)}
    save_projects(projects, projects_path)
    for sub in ("notes", "inbox"):
        (path / sub).mkdir(exist_ok=True)
    return {"id": pid, "name": saved["name"], "path": str(path), "notes": saved["notes"]}


def project_remove(api, path: Path, delete: bool = False, projects_path: Path = PROJECTS) -> dict:
    """Stops syncing `path` (its files stay); `delete` also removes the project in the app (its notes stay there)."""
    path = path.expanduser().resolve()
    projects = load_projects(projects_path)
    pid = next((pid for pid, p in projects.items() if Path(p["path"]) == path), None)
    if pid is None:
        raise ToolError(f"{path} isn't a project (reader project list shows them)")
    gone = projects.pop(pid)
    if delete:
        api.delete(f"/api/projects/{pid}")
    save_projects(projects, projects_path)
    return gone


def project_list(api, projects_path: Path = PROJECTS) -> list[dict]:
    """The app's projects, with their folder on this computer (or None)."""
    here = load_projects(projects_path)
    return [{**p, "path": here.get(p["id"], {}).get("path")} for p in api.get("/api/projects")]
