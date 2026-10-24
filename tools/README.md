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

## Adding books

```bash
./reader add book.pdf --lang de [--title "…"] [--author "…"] [--cover cover.jpg]
./reader add book.epub                      # title, author, language and cover come from the EPUB
./reader add-quarto ~/Documents/MyCourse/book --lang en [--pdf ~/Documents/MyCourse/book/_book/Book.pdf]
./reader list
./reader delete <book id>
```

- A PDF's cover is its first page; an EPUB's is the cover image it declares.
- `--id <book id>` updates an existing book: new files replace the old ones, other formats stay. Use it to
  add a PDF to a Quarto book, or to upload a new edition.
- `add-quarto` renders the book to HTML in a temporary copy (the book folder is never written to; frozen
  computations are reused) and packages it as a **reflow** book. `--pdf` adds a PDF of the same book as a
  second format, and its first page as the cover.

## The reflow format

A zip the app reads chapter by chapter:

```
book.json            {"format": 1, "title", "subtitle", "author", "language",
                      "chapters": [{"file", "title", "part"}], "styles": ["book.css", "book-dark.css"]}
index.html           a chapter: an HTML fragment (no <html>/<head>), or Markdown (.md)
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
