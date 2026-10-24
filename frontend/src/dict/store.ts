/**
 * Installed dictionaries: SQLite on Android (the prebuilt database, downloaded and unzipped by the plugin),
 * IndexedDB on the web (imported once from the JSON lines package). Both answer the same lookups.
 */
import { Capacitor } from '@capacitor/core';
import { api } from '@/services/api';
import { store as fileStore } from '@/services/bookCache';
import { getPref, setPref } from '@/services/prefs';
import type { Dictionary } from '@/services/types';
import { nativeDictStore } from './sqliteStore';
import { webDictStore } from './webStore';

export interface DictEntry {
  headword: string;
  def: string;
}

export interface DictBackend {
  /** Download and install; `onProgress` gets 0..1 when the size is known */
  install(dict: Dictionary, url: string, onProgress: (fraction: number) => void): Promise<void>;
  remove(dictId: string): Promise<void>;
  /** Entries whose key (or synonym) is one of `keys`, in the order of `keys`; `folded` searches fkey */
  lookup(dictId: string, keys: string[], folded: boolean): Promise<DictEntry[]>;
  /** Headwords starting with `prefix` (for "did you mean") */
  prefix(dictId: string, prefix: string, limit: number): Promise<string[]>;
}

export interface InstalledDict {
  id: string;
  name: string;
  from_lang: string;
  to_lang: string;
  entry_count: number;
  sha256: string; // of the package installed, to notice a newer one
  res?: string; // sha256 of the images zip, when it has one
}

const KEY = 'dicts_installed';
export const backend: DictBackend = Capacitor.isNativePlatform() ? nativeDictStore : webDictStore;
/** The package this platform installs */
export const PACKAGE: 'sqlite' | 'jsonl' = Capacitor.isNativePlatform() ? 'sqlite' : 'jsonl';

const listeners = new Set<() => void>();
export function subscribeDicts(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function installedDicts(): Promise<Record<string, InstalledDict>> {
  return (await getPref<Record<string, InstalledDict>>(KEY)) ?? {};
}

async function saveInstalled(all: Record<string, InstalledDict>): Promise<void> {
  await setPref(KEY, all);
  listeners.forEach((l) => l());
}

export async function installDict(dict: Dictionary, onProgress: (fraction: number) => void): Promise<void> {
  const file = dict.files[PACKAGE];
  if (!file) throw new Error('This dictionary has no package for this device');
  const link = await api<{ url: string }>(`/api/dictionaries/${encodeURIComponent(dict.id)}/download?kind=${PACKAGE}`);
  await backend.install(dict, link.url, onProgress);
  if (dict.files.res) {
    const res = await api<{ url: string }>(`/api/dictionaries/${encodeURIComponent(dict.id)}/download?kind=res`);
    await fileStore.save(`dict-${dict.id}/res`, res.url, dict.files.res.size);
  }
  const all = await installedDicts();
  all[dict.id] = { id: dict.id, name: dict.name, from_lang: dict.from_lang, to_lang: dict.to_lang,
    entry_count: dict.entry_count, sha256: file.sha256, res: dict.files.res?.sha256 };
  await saveInstalled(all);
}

export async function removeDict(dictId: string): Promise<void> {
  const all = await installedDicts();
  await backend.remove(dictId);
  if (all[dictId]?.res) await fileStore.remove(`dict-${dictId}/res`);
  delete all[dictId];
  await saveInstalled(all);
}
