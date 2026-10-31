"""reader — add books to the library from this computer, and sync this computer's folder with the app.

  reader login you@example.com [--server URL]      (emails a code)
  reader login you@example.com --code 123456
  reader sync [--folder ~/pico] [--interval 5] [--once] [--install | --uninstall]
  reader project add [PATH] [--name N]      (this folder's notes/ and inbox/ sync with the app's project N)
  reader project list
  reader project remove [PATH] [--delete]   (stop syncing it; --delete: also remove the project in the app)
  reader add book.pdf|book.epub [--title T] [--author A] [--lang de] [--id ID] [--cover image]
  reader add book.pdf --reflow | --reflow-from marker-output.md     (also a text version)
  reader add-markdown book.md --title T [--author A] --lang de
  reader add-quarto path/to/book [--lang en] [--pdf book.pdf] [--id ID] [--cover image]
  reader list
  reader delete ID
  reader index [BOOK_ID ...] [--all] [--force] [--server]  (search index: here, or queued on the server)
  reader dict-add path/to/stardict-folder --from de --to es [--name N]
  reader dict-add-all ~/Documents/dic/converted [--map dictionaries.json] [--only duden,ldaf]
  reader dict-list
  reader dict-delete ID
"""

import argparse
import sys

from pico_core import stardict
from readertool.client import ToolError
from readertool.commands import account, books, dictionaries, index, sync

COMMANDS = [account, books, index, dictionaries, sync]  # the order they're listed in --help


def main() -> None:
    p = argparse.ArgumentParser(prog="reader", description="Add books to the reader's library.")
    sub = p.add_subparsers(dest="cmd", required=True)
    for command in COMMANDS:
        command.register(sub)
    args = p.parse_args()
    try:
        args.run(args)
    except (ToolError, stardict.StarDictError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
