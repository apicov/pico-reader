/** Lookup keys, the same rules as the converter (tools/readertool/stardict.py key_of / fold). */

/** NFC + lower case: the exact key */
export function keyOf(word: string): string {
  return word.normalize('NFC').trim().toLowerCase();
}

/** Without accents: the looser second try (ß stays ß) */
export function fold(key: string): string {
  return key.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

/** The word to look up from a selection: letters (with inner apostrophes and hyphens) only. */
export function cleanWord(selection: string): string {
  return selection.normalize('NFC').trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[­​]/g, ''); // soft hyphens from hyphenated text
}
