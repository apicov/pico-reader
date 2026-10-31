"""reader sync and reader project: this computer's folders and the app."""

import contextlib
from pathlib import Path

from readertool import projects, service, sync
from readertool.client import Api


def register(sub) -> None:
    s = sub.add_parser("sync", help="sync a folder on this computer with the app (inbox, outbox, notes)")
    s.add_argument("--folder", type=Path, default=Path("~/pico"))
    s.add_argument("--interval", type=float, default=5, help="seconds between asking the server (files saved here go at once)")
    s.add_argument("--once", action="store_true", help="one round, then stop")
    s.add_argument("--install", action="store_true", help="run it as a systemd user service (starts with the session)")
    s.add_argument("--uninstall", action="store_true", help="stop and remove the service")
    s.set_defaults(run=sync_folder)
    s = sub.add_parser("project", help="link folders on this computer to projects in the app")
    psub = s.add_subparsers(dest="action", required=True)
    a = psub.add_parser("add", help="this folder (or PATH) becomes a project: its notes/ and inbox/ sync with the app")
    a.add_argument("path", type=Path, nargs="?", default=Path("."))
    a.add_argument("--name", help="the project's name in the app (default: the folder's name)")
    a.set_defaults(run=project_add)
    psub.add_parser("list", help="the projects, and where they are on this computer").set_defaults(run=project_list)
    r = psub.add_parser("remove", help="stop syncing this folder (or PATH); its files stay")
    r.add_argument("path", type=Path, nargs="?", default=Path("."))
    r.add_argument("--delete", action="store_true", help="also remove the project in the app (its notes stay)")
    r.set_defaults(run=project_remove)


def sync_folder(args) -> None:
    if args.uninstall:
        return service.uninstall()
    if args.install:
        Api()  # signed in?
        return service.install(args.folder, args.interval)
    with contextlib.suppress(KeyboardInterrupt):
        sync.run(Api(), args.folder, args.interval, args.once)


def project_add(args) -> None:
    p = projects.project_add(Api(), args.path, args.name)
    print(f"project “{p['name']}” ({p['notes']} notes) ⇄ {p['path']}/notes, things sent to it → {p['path']}/inbox")
    if not service.service_installed():
        print("the sync isn't running as a service: reader sync --install (or run reader sync)")


def project_list(_args) -> None:
    linked = projects.project_list(Api())
    for p in linked:
        print(f"{p['name']:30} {p['notes']:4} notes  {p['path'] or '(not on this computer)'}")
    if not linked:
        print("no projects yet: cd into a folder and run `reader project add`")


def project_remove(args) -> None:
    gone = projects.project_remove(Api(), args.path, args.delete)
    print(f"stopped syncing {gone['path']}" + (f"; “{gone['name']}” removed in the app, its notes kept" if args.delete else ""))
