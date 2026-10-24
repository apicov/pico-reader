# tools/ — adding books from your computer

`reader` uploads books to the library through the backend's admin API: the backend hands out signed
upload links, the files go straight to R2, and the book appears in the app once all files are in.

## Setup

```bash
cd tools
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

For Quarto books, `quarto` must be on the PATH (it also provides the Sass compiler used for the book's
styles).

## Signing in

Only admin readers can add books ([docs/04](../docs/04-backend.md) §7). Two steps, like the app:

```bash
./reader login you@example.com                  # emails a code
./reader login you@example.com --code 123456    # saves a token in ~/.config/pico-reader/tool.json
```

`--server URL` points the tool at another backend (default `https://books.apicov.xyz`; e.g.
`http://localhost:8030` for local development).

Tests: `.venv/bin/pip install -r requirements-dev.txt && PYTHONPATH=. .venv/bin/pytest tests`.

## Adding books

```bash
./reader add book.pdf --lang de [--title "…"] [--author "…"] [--cover cover.jpg]
./reader add book.epub                      # title, author, language and cover come from the EPUB
./reader add book.pdf --lang de --reflow                       # + a text version made with marker
./reader add book.pdf --lang de --reflow-from marker-out/book.md  # + a text version from existing Markdown
./reader add-markdown notes.md --title "…" --lang de [--author "…"]
./reader add-quarto ~/Documents/MyCourse/book --lang en [--pdf ~/Documents/MyCourse/book/_book/Book.pdf]
./reader list
./reader delete <book id>
```

- A PDF's cover is its first page; an EPUB's is the cover image it declares.
- `--id <book id>` updates an existing book: new files replace the old ones, other formats stay. Use it to
  add a PDF to a Quarto book, or to upload a new edition.
- A text ("reflow") version makes a PDF comfortable on a phone: the app switches between the two and
  keeps your place. `--reflow` runs [marker](https://github.com/datalab-to/marker) (`pip install marker-pdf`,
  `marker_single` on the PATH); `--reflow-from` takes Markdown you already have.
- `add-markdown` (and the text versions) convert Markdown with pandoc (Quarto's, or a standalone pandoc):
  `$…$` and `$$…$$` math is kept for KaTeX, images next to the `.md` file are included, and the text is
  split into chapters at its `#` headings (or `##`, or into even parts when it has none).
- `add-quarto` renders the book to HTML in a temporary copy (the book folder is never written to; frozen
  computations are reused) and packages it as a **reflow** book. `--pdf` adds a PDF of the same book as a
  second format, and its first page as the cover.

## Dictionaries

StarDict dictionaries (`.ifo`, `.idx`, `.dict` or `.dict.dz`, optional `.syn` and `res/`) are converted on
this computer and uploaded; the app installs the ones you pick (Settings → Dictionaries) and looks words up
offline.

```bash
./reader dict-add ~/Documents/dic/converted/duden --from de --to de
./reader dict-add-all ~/Documents/dic/converted          # every folder listed in dictionaries.json
./reader dict-add-all ~/Documents/dic/converted --only duden,ldaf
./reader dict-list
./reader dict-delete <dictionary id>
```

- `dictionaries.json` maps each folder name to its language pair (headwords → definitions). StarDict files
  don't state it reliably, so add new folders there.
- The id comes from the folder name: converting a folder again replaces that dictionary.
- Each dictionary becomes up to three packages: `sqlite` (a zip with `<id>SQLite.db`, for Android), `jsonl`
  (gzip'd JSON lines, imported into the browser's IndexedDB) and `res` (the images its definitions use).
  Definitions are stored as HTML (plain text is escaped, XDXF mapped to simple HTML).
- Lookup keys: `key` = NFC + lower case, `fkey` = the key without accents (ß stays ß). The app computes the
  same keys (`frontend/src/dict/normalize.ts`) and tries the selected word, then common dictionary forms
  (`frontend/src/dict/forms.ts`), then the accent-free keys.
- These dictionaries are for personal use: the bucket is private and every download needs a signed-in reader.

## The reflow format

A zip the app reads chapter by chapter:

```
book.json            {"format": 1, "title", "subtitle", "author", "language",
                      "chapters": [{"file", "title", "part"}], "styles": ["book.css", "book-dark.css"]}
index.html           a chapter: an HTML fragment (no <html>/<head>)
chapters/*.html      more chapters, in the order of book.json
chapters/*_files/…   images, referenced by paths relative to the chapter file
figures/…
book.css             optional: the book's own styles (book-dark.css only in dark themes)
```

The app sanitizes chapter HTML (no scripts), typesets `<span class="math inline|display">` TeX with
KaTeX, and follows links between chapters. Links to local files (`file://`) are shown as plain text.

From a Quarto book, each chapter is the content of the rendered page's `<main>`, without Quarto's
navigation, and `book.css` is the book's own `.scss` theme files compiled without Quarto's Bootstrap
theme.
