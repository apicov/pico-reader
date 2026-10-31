"""reader dict-add, dict-add-all, dict-list, dict-delete: StarDict dictionaries, converted here and uploaded."""

import json
import tempfile
from pathlib import Path

from pico_core import stardict
from pico_core.formats import DICT_PACKAGE_TYPES
from readertool.client import Api

DICTIONARY_MAP = Path(__file__).resolve().parents[2] / "dictionaries.json"  # tools/dictionaries.json


def register(sub) -> None:
    s = sub.add_parser("dict-add", help="convert and upload a StarDict dictionary")
    s.add_argument("folder", type=Path)
    s.add_argument("--from", dest="from_lang", required=True, help="language of the headwords, e.g. de")
    s.add_argument("--to", dest="to_lang", required=True, help="language of the definitions")
    s.add_argument("--name", help="name shown in the app (default: the dictionary's own)")
    _visibility(s)
    s.set_defaults(run=dict_add)
    s = sub.add_parser("dict-add-all", help="convert and upload every dictionary listed in the map file")
    s.add_argument("folder", type=Path)
    s.add_argument("--map", type=Path, default=DICTIONARY_MAP)
    s.add_argument("--only", help="comma-separated folder names")
    _visibility(s)
    s.set_defaults(run=dict_add_all)
    sub.add_parser("dict-list", help="list the dictionaries").set_defaults(run=dict_list)
    s = sub.add_parser("dict-delete", help="delete a dictionary")
    s.add_argument("id")
    s.set_defaults(run=dict_delete)


def _visibility(parser) -> None:
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--private", dest="visibility", action="store_const", const="private",
                   help="only you (and admins) see it; default for a new one: everyone; an update keeps its setting")
    g.add_argument("--public", dest="visibility", action="store_const", const="everyone", help="every reader sees it")


def _upload_dictionary(folder: Path, from_lang: str, to_lang: str, name: str | None, visibility: str | None = None) -> None:
    print(f"{folder.name} [{from_lang} → {to_lang}]")
    d = stardict.read(folder)
    dict_id = stardict.dict_id_for(folder)
    print(f"  {len(d.entries)} entries, {len(d.synonyms)} synonyms, {len(d.images)} images")
    with tempfile.TemporaryDirectory() as tmp:
        files = stardict.write_packages(d, dict_id, Path(tmp))
        sizes = ", ".join(f"{k} {p.stat().st_size / 1e6:.1f} MB" for k, p in files.items())
        print(f"  packages: {sizes}")
        Api().upload("dictionaries", {"id": dict_id, "name": name or d.name, "from_lang": from_lang,
                                      "to_lang": to_lang, "entry_count": len(d.entries),
                                      **({"visibility": visibility} if visibility else {})},
                     {kind: (path, DICT_PACKAGE_TYPES[kind]) for kind, path in files.items()})
    print(f"  added as {dict_id}")


def dict_add(args) -> None:
    _upload_dictionary(args.folder, args.from_lang, args.to_lang, args.name, args.visibility)


def dict_add_all(args) -> None:
    mapping = {k: v for k, v in json.loads(args.map.read_text()).items() if not k.startswith("_")}
    only = set(args.only.split(",")) if args.only else None
    for folder in sorted(p for p in args.folder.iterdir() if p.is_dir()):
        if only and folder.name not in only:
            continue
        if folder.name not in mapping:
            print(f"skipping {folder.name}: not in {args.map.name}")
            continue
        try:
            _upload_dictionary(folder, *mapping[folder.name], None, args.visibility)
        except Exception as e:  # one broken dictionary mustn't stop the rest
            print(f"  failed: {e}")


def dict_list(_args) -> None:
    for d in Api().get("/api/library")["dictionaries"]:
        print(f"{d['id']:45} {d['from_lang']}→{d['to_lang']} {d['entry_count']:>8}  {d['name']}")


def dict_delete(args) -> None:
    Api().delete(f"/api/admin/dictionaries/{args.id}")
    print(f"deleted {args.id}")
