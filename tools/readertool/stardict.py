"""StarDict dictionaries (.ifo/.idx/.dict[.dz]/.syn + res/) → the two packages the app installs:

- sqlite: a zip holding `<id>SQLite.db` (the name the Android SQLite plugin expects), opened as is on Android
- jsonl:  gzip'd JSON lines, imported into IndexedDB by the web app
- res:    a zip of the images the definitions show (only those they reference)

Both carry the same rows. Lookup keys are computed here for SQLite and with the same rules in the app
(frontend/src/dict/normalize.ts): `key` = NFC + lower case, `fkey` = `key` without accents (a looser
second try; ß stays ß).
"""

import gzip
import html
import json
import re
import sqlite3
import struct
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from readertool.client import ToolError


def key_of(word: str) -> str:
    return unicodedata.normalize("NFC", word).strip().lower()


def fold(key: str) -> str:
    stripped = "".join(c for c in unicodedata.normalize("NFD", key) if not unicodedata.combining(c))
    return unicodedata.normalize("NFC", stripped)


@dataclass
class Dictionary:
    folder: Path
    info: dict[str, str]
    entries: list[tuple[str, str]] = field(default_factory=list)  # (headword, definition HTML)
    synonyms: list[tuple[str, int]] = field(default_factory=list)  # (word, entry index)
    images: set[str] = field(default_factory=set)

    @property
    def name(self) -> str:
        return self.info.get("bookname", self.folder.name).strip()


def _find(folder: Path, *suffixes: str) -> Path | None:
    for suffix in suffixes:
        found = sorted(folder.glob(f"*{suffix}"))
        if found:
            return found[0]
    return None


def read(folder: Path) -> Dictionary:
    ifo = _find(folder, ".ifo")
    idx = _find(folder, ".idx", ".idx.gz")
    dict_file = _find(folder, ".dict.dz", ".dict")
    if not (ifo and idx and dict_file):
        raise ToolError(f"{folder} is not a StarDict dictionary (.ifo, .idx and .dict needed)")
    info = {}
    for line in ifo.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        if "=" in line:
            k, v = line.split("=", 1)
            info[k.strip()] = v.strip()
    d = Dictionary(folder, info)
    offset_size = 8 if info.get("idxoffsetbits") == "64" else 4
    index = gzip.open(idx).read() if idx.suffix == ".gz" else idx.read_bytes()
    data = gzip.open(dict_file).read() if dict_file.suffix == ".dz" else dict_file.read_bytes()
    types = info.get("sametypesequence", "")
    res = folder / "res"

    pos = 0
    fmt = ">QI" if offset_size == 8 else ">II"
    while pos < len(index):
        end = index.index(b"\0", pos)
        word = index[pos:end].decode("utf-8", errors="replace")
        offset, size = struct.unpack_from(fmt, index, end + 1)
        pos = end + 1 + offset_size + 4
        definition = _to_html(data[offset:offset + size], types)
        for src in re.findall(r'<img[^>]+src="([^"/:]+)"', definition):
            if (res / src).is_file():
                d.images.add(src)
        d.entries.append((word, definition))

    syn = _find(folder, ".syn")
    if syn:
        raw = syn.read_bytes()
        pos = 0
        while pos < len(raw):
            end = raw.index(b"\0", pos)
            word = raw[pos:end].decode("utf-8", errors="replace")
            (entry,) = struct.unpack_from(">I", raw, end + 1)
            pos = end + 5
            if entry < len(d.entries):
                d.synonyms.append((word, entry))
    return d


def _fields(raw: bytes, types: str):
    """(type, bytes) of each field of one entry (StarDict 'sametypesequence' rules)."""
    pos = 0
    if types:
        for i, t in enumerate(types):
            last = i == len(types) - 1
            if t.islower():
                end = len(raw) if last else raw.find(b"\0", pos)
                end = len(raw) if end < 0 else end
                yield t, raw[pos:end]
                pos = end + 1
            else:
                if last:
                    yield t, raw[pos:]
                else:
                    (n,) = struct.unpack_from(">I", raw, pos)
                    yield t, raw[pos + 4:pos + 4 + n]
                    pos += 4 + n
        return
    while pos < len(raw):
        t = chr(raw[pos])
        pos += 1
        if t.islower():
            end = raw.find(b"\0", pos)
            end = len(raw) if end < 0 else end
            yield t, raw[pos:end]
            pos = end + 1
        else:
            (n,) = struct.unpack_from(">I", raw, pos)
            yield t, raw[pos + 4:pos + 4 + n]
            pos += 4 + n


_XDXF = [(r"<k>", "<b>"), (r"</k>", "</b>"), (r"<ex>", '<i class="ex">'), (r"</ex>", "</i>"),
         (r"<abr>", "<i>"), (r"</abr>", "</i>"), (r"<kref>", "<b>"), (r"</kref>", "</b>"),
         (r"<tr>", "["), (r"</tr>", "]"), (r"<c(?: c=\"[^\"]*\")?>", "<span>"), (r"</c>", "</span>"),
         (r"</?(?:dtrn|co|blockquote|opt|rref|iref)[^>]*>", "")]


def _to_html(raw: bytes, types: str) -> str:
    parts = []
    for t, data in _fields(raw, types):
        text = data.decode("utf-8", errors="replace")
        if t in "hg":  # HTML, Pango markup (close enough to HTML)
            parts.append(text)
        elif t == "x":  # XDXF
            for pattern, repl in _XDXF:
                text = re.sub(pattern, repl, text)
            parts.append(text.replace("\n", "<br>"))
        elif t in "mtyl":  # plain text, phonetics, yinbiao, locale text
            escaped = html.escape(text).replace("\n", "<br>")
            parts.append(f'<span class="phonetic">[{escaped}]</span>' if t == "t" else escaped)
        # other types (wav, pictures, …) aren't shown
    return "<br>".join(p for p in parts if p)


def write_packages(d: Dictionary, dict_id: str, out: Path) -> dict[str, Path]:
    """Build sqlite (zip), jsonl.gz and (when there are images) res zip in `out`."""
    db_path = out / f"{dict_id}SQLite.db"
    db_path.unlink(missing_ok=True)
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT NOT NULL, key TEXT NOT NULL,
                              fkey TEXT NOT NULL, def TEXT NOT NULL);
        CREATE TABLE syn (key TEXT NOT NULL, fkey TEXT NOT NULL, entry_id INTEGER NOT NULL);
    """)
    rows = []
    for i, (word, definition) in enumerate(d.entries):
        k = key_of(word)
        rows.append((i, word, k, fold(k), definition))
    con.executemany("INSERT INTO entries VALUES (?, ?, ?, ?, ?)", rows)
    con.executemany("INSERT INTO syn VALUES (?, ?, ?)", [(key_of(w), fold(key_of(w)), e) for w, e in d.synonyms])
    con.executemany("INSERT INTO meta VALUES (?, ?)", [("name", d.name), ("format", "1")])
    con.executescript("""
        CREATE INDEX entries_key ON entries (key); CREATE INDEX entries_fkey ON entries (fkey);
        CREATE INDEX syn_key ON syn (key); CREATE INDEX syn_fkey ON syn (fkey);
    """)
    con.commit()
    con.execute("VACUUM")
    con.close()
    files = {"sqlite": out / f"{dict_id}.zip"}
    with zipfile.ZipFile(files["sqlite"], "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.write(db_path, db_path.name)
    db_path.unlink()

    files["jsonl"] = out / f"{dict_id}.jsonl.gz"
    with gzip.open(files["jsonl"], "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(json.dumps({"name": d.name, "format": 1}, ensure_ascii=False) + "\n")
        for i, (word, definition) in enumerate(d.entries):
            f.write(json.dumps([i, word, definition], ensure_ascii=False) + "\n")
        for word, entry in d.synonyms:
            f.write(json.dumps([word, entry], ensure_ascii=False) + "\n")

    if d.images:
        files["res"] = out / f"{dict_id}-res.zip"
        with zipfile.ZipFile(files["res"], "w", zipfile.ZIP_STORED) as z:
            for name in sorted(d.images):
                z.write(d.folder / "res" / name, name)
    return files


def dict_id_for(folder: Path) -> str:
    """Stable id from the folder name, so converting again updates the same dictionary."""
    ascii_name = unicodedata.normalize("NFKD", folder.name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:60] or "dictionary"
