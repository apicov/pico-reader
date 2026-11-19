# 19 Viewing a file

Reading a PDF, EPUB or Markdown file from the device without adding it to the library: for a quick look, or a file
that isn't meant for the shared library.

## How it works

- The "Add a book" page (+) has a **Just read a file** card: **Open a file** (one PDF, EPUB or Markdown file) and
  **Open a Markdown folder** (a Markdown file with its pictures, e.g. marker's output). It works offline.
- The picked file goes into a slot in memory (`frontend/src/reader/viewedFile.ts`), and the app goes to `#/view`
  (`frontend/src/pages/ViewFilePage.tsx`), which takes it from there. A Markdown file becomes a reflow bundle on the
  device, as on upload (`upload/markdown.ts`); the views are the reader's own (`reader/formatViews.tsx`).
- Closing it (×, Back), leaving the page or restarting the app lets it go: `#/view` without a file goes to the
  "Add a book" page.

## What isn't done

Nothing about the file is stored or sent: no upload, no index, no reading place, no highlights or bookmarks, no
"Currently reading", no workspace tab, no reading time. The selection panel offers copying, looking up and translating
(no highlighting, quoting or sending to the computer).

The lookups and translations themselves are recorded as everywhere else (statistics, translation history), with no
book (`book_id` null), as on the Dictionary page.

## Language

For looking words up: the EPUB's own language; for Markdown, guessed from the text (`guessLanguage`); for a PDF,
guessed from the text once a page is shown. Unknown, every dictionary is searched and translation detects it.

## Android

The app's own selection panel replaces Android's floating menu on `#/view` as on `#/read/…`
(`MainActivity.java`), so the Android app needs a rebuild for that.
