import { unzipSync } from 'fflate';
import { store as fileStore } from '@/services/bookCache';
import { getPref, setPref } from '@/services/prefs';
import { candidateForms } from './forms';
import { cleanWord, fold, keyOf } from './normalize';
import { backend, installedDicts, isCurrent, type DictEntry, type InstalledDict } from './store';

export interface DictResult {
  dict: InstalledDict;
  entries: DictEntry[];
  /** true when only the accent-insensitive try found something */
  loose: boolean;
}

export interface Lookup {
  word: string;
  results: DictResult[];
  suggestions: string[];
}

const PREFERRED = 'dict_preferred'; // { [language]: dictId }

export async function preferredDict(language: string): Promise<string | null> {
  return (await getPref<Record<string, string>>(PREFERRED))?.[language] ?? null;
}

export async function setPreferredDict(language: string, dictId: string): Promise<void> {
  const all = (await getPref<Record<string, string>>(PREFERRED)) ?? {};
  all[language] = dictId;
  await setPref(PREFERRED, all);
}

/** The installed dictionaries for a language, the preferred one first. */
export async function dictsFor(language: string): Promise<InstalledDict[]> {
  const preferred = await preferredDict(language);
  return Object.values(await installedDicts())
    .filter((d) => d.from_lang === language && isCurrent(d))
    .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)
      || Number(a.to_lang === a.from_lang) - Number(b.to_lang === b.from_lang) || a.name.localeCompare(b.name));
}

/** Look a word up in every installed dictionary for `language`: the word, then its likely dictionary
 *  forms, then the same without accents; prefix suggestions when nothing matches. */
export async function lookUp(selection: string, language: string): Promise<Lookup> {
  const word = cleanWord(selection);
  const key = keyOf(word);
  const forms = candidateForms(key, language);
  const dicts = await dictsFor(language);
  const results = await Promise.all(dicts.map(async (dict) => {
    let entries = await backend.lookup(dict.id, forms, false);
    let loose = false;
    if (!entries.length) {
      entries = await backend.lookup(dict.id, [...new Set(forms.map(fold))], true);
      loose = entries.length > 0;
    }
    return { dict, entries, loose };
  }));
  let suggestions: string[] = [];
  if (dicts.length && results.every((r) => !r.entries.length)) {
    const stem = fold(key).slice(0, Math.max(3, key.length - 3));
    suggestions = [...new Set((await Promise.all(dicts.map((d) => backend.prefix(d.id, stem, 8)))).flat())].slice(0, 12);
  }
  return { word, results: results.filter((r) => r.entries.length), suggestions };
}

const imageMaps = new Map<string, Promise<Map<string, string>>>();

/** blob: URLs for a dictionary's images (from its res zip), by file name */
export function dictImages(dictId: string): Promise<Map<string, string>> {
  let p = imageMaps.get(dictId);
  if (!p) {
    p = (async () => {
      const files = unzipSync(new Uint8Array(await (await fileStore.blob(`dict-${dictId}/res`)).arrayBuffer()));
      return new Map(Object.entries(files).map(([name, data]) => [name, URL.createObjectURL(new Blob([data as BlobPart]))]));
    })();
    imageMaps.set(dictId, p);
    p.catch(() => imageMaps.delete(dictId));
  }
  return p;
}
