import gzip
import json
import struct
import zipfile

import pytest

from pico_core import stardict


def write_stardict(folder, entries, gzip_dict=False):
    folder.mkdir(parents=True)
    data, idx = b"", b""
    for word, definition in entries:
        raw = definition.encode()
        idx += word.encode() + b"\0" + struct.pack(">II", len(data), len(raw))
        data += raw
    (folder / "mini.ifo").write_text(f"StarDict's dict ifo file\nversion=2.4.2\nbookname=Mini\nwordcount={len(entries)}\n"
                                     f"idxfilesize={len(idx)}\nsametypesequence=m\n")
    (folder / "mini.idx").write_bytes(idx)
    if gzip_dict:
        (folder / "mini.dict.dz").write_bytes(gzip.compress(data))
    else:
        (folder / "mini.dict").write_bytes(data)
    (folder / "mini.syn").write_bytes(b"Haeuser\0" + struct.pack(">I", 0))


@pytest.mark.parametrize("gzip_dict", [False, True])
def test_reads_and_writes_both_packages(tmp_path, gzip_dict):
    write_stardict(tmp_path / "Mini Wörterbuch", [("Haus", "das Gebäude"), ("Straße", "der Weg")], gzip_dict)
    d = stardict.read(tmp_path / "Mini Wörterbuch")
    assert d.name == "Mini" and [w for w, _ in d.entries] == ["Haus", "Straße"]
    dict_id = stardict.dict_id_for(tmp_path / "Mini Wörterbuch")
    assert dict_id == "mini-worterbuch"
    out = tmp_path / "out"
    out.mkdir()
    files = stardict.write_packages(d, dict_id, out)
    assert set(files) == {"sqlite", "jsonl"}  # no images: no res
    with gzip.open(files["jsonl"], "rt") as f:
        lines = [json.loads(line) for line in f]
    assert lines[0]["name"] == "Mini" and lines[1][1] == "Haus" and lines[-1] == ["Haeuser", 0]
    with zipfile.ZipFile(files["sqlite"]) as z:
        assert z.namelist() == [f"{dict_id}SQLite.db"]


def test_keys_ignore_case_and_the_loose_key_accents():
    assert stardict.key_of(" Straße ") == "straße" and stardict.fold("café") == "cafe" and stardict.fold("straße") == "straße"


def test_a_folder_that_isnt_a_dictionary_says_so(tmp_path):
    with pytest.raises(stardict.StarDictError, match="not a StarDict dictionary"):
        stardict.read(tmp_path)
    assert issubclass(stardict.StarDictError, ValueError)  # the server's job reports it as a bad upload
