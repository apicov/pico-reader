# 10 — Uploads, the indexing queue and offline search

## Adding books from the app

Any signed-in reader can add books to the shared library (the "+" in the library's top bar, `UploadPage`):

- **EPUB:** title, author, language and cover are read on the device from the book's OPF.
- **PDF:** title and author come from the PDF metadata; the cover is page 1, drawn with pdf.js.
- **Markdown** (a `.md` with its images, or a folder): converted on the device to a reflow bundle
  (`src/upload/markdown.ts`), like `tools/readertool/markdown.py`. Math stays TeX for KaTeX, and the text is
  split into chapters at `#` (or `##`) headings.

Before sending, the reader edits title, author and language, and adds the book as a new one or as another
format of a book they may change. Files go straight to R2 through signed links (`POST /api/books`, PUT,
`POST /api/books/{id}/commit`).

**Who may change a book:** the reader who added it, or an admin (`books.uploaded_by`). Everyone else only reads
it.

**History:** `book_events` keeps who did what and when: uploaded, files changed, deleted, reindexed, indexed,
index failed. Entries stay after the book is gone.
- Readers see their own entries on the Upload page; admins see everyone's.
- Admins can also list it with `python -m app.cli history` (see [04](04-backend.md)).

## The indexing queue

Committing a book whose reading text changed queues an `index_jobs` row. The `pico-reader-indexer` service
(`app/indexer.py`) takes one job at a time:

1. download the file from R2;
2. cut it into passages (`app/passages.py`);
3. embed them (`app/embed.py`, one thread);
4. write `book_chunks` / `book_index`, the book's word count, and its **search file**;
5. record the result in the history.

Failed jobs are retried twice, then marked `failed` with the reason. A restart puts interrupted jobs back in
the queue. After 5 minutes without jobs the model leaves memory.

On the 1-vCPU server a 250-passage novel takes about 1.5 minutes and a 550-passage textbook about 3. The
library shows "Queued for search (n)" and "Making it searchable…" until it's done.

`reader index` on a desktop is faster for big batches; `reader index --server` queues the server instead.

## Offline search

**The search file** (`books/<id>/search-<hash>.json.gz`, the book's `search` file kind) holds every passage
(location, progress, heading, text) and its vector as float16. The indexer writes it, and so does
`reader index` through `/index/finish`.

**On the device** (Settings → Offline search):
- **The model:** switching it on loads multilingual-e5-small with transformers.js, about 135 MB once, kept
  by the browser. It's the same quantized ONNX file the server uses, so questions embedded on the device
  match the server's passage vectors.
- **The runtime:** the ONNX WebAssembly runtime is served by the app from `/ort/`, copied there at build
  time. It's bundled in the Android app, and cached by the service worker on the web.
- **Search files:** the device fetches the search files of the books it has downloaded, and of each book
  opened later.

**Searching:** without a connection, the chat page becomes a search over those books (`src/search/`).
- **Ranking:** passages are ranked by cosine similarity and by words, fused like the server's search.
- **Results:** a result opens the book at the passage.
- **No answers:** the chat's answers need the server's model, so offline search shows passages only.

**The browser test** (Settings, under offline search): it embeds a sample of a book's passages with
transformers.js on the device, then shows the speed, the time a whole book would take, and how close the
vectors are to the server's. Use it to judge whether indexing on a given device would be practical.
