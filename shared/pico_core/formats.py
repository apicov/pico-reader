"""Book and dictionary formats both sides agree on."""

# a book's text formats, the best text first: the search index is built from the first one a book has
TEXT_FORMATS = ["reflow", "epub", "pdf"]

# the packages a StarDict dictionary is converted to (stardict.write_packages), with their content types
DICT_PACKAGE_TYPES = {"sqlite": "application/zip", "jsonl": "application/gzip", "res": "application/zip"}
