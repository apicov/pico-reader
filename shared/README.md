# pico_core

Code the server (`backend/`) and the desktop tool (`tools/`) share: books → passages (`passages.py`), their
embeddings (`embed.py`), the search index rows (`indexing.py`), StarDict → the app's dictionary packages
(`stardict.py`), and the formats both agree on (`formats.py`).

Both install it editable from their requirements (`-e ../shared`, run from `backend/` or `tools/`), so a change
here is live in both without reinstalling. Tests: `backend/.venv/bin/pytest shared/tests` from the repository root.
