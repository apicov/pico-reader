/**
 * StarDict uploads (admins): one zip of the dictionary's files, converted on the server into the packages devices
 * install (backend dictionary_service.convert). Here: read its .ifo for the name, and zip loose files.
 */
import { unzipSync, zipSync } from 'fflate';

export interface IfoInfo {
  name: string;
  wordcount: number;
}

export function parseIfo(text: string): IfoInfo {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const at = line.indexOf('=');
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { name: fields.bookname ?? '', wordcount: Number(fields.wordcount) || 0 };
}

const STARDICT = /\.(ifo|idx|idx\.gz|dict|dict\.dz|syn)$/i;

/** The files the server needs, from a picked zip or loose files (images keep their res/ path). */
export async function stardictZip(files: File[]): Promise<{ zip: Blob; info: IfoInfo }> {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const data = new Uint8Array(await files[0].arrayBuffer());
    const ifos = unzipSync(data, { filter: (f) => /\.ifo$/i.test(f.name) });
    const ifo = Object.values(ifos)[0];
    if (!ifo) throw new Error('No .ifo file in this zip: is it a StarDict dictionary?');
    return { zip: new Blob([data], { type: 'application/zip' }), info: parseIfo(new TextDecoder().decode(ifo)) };
  }
  const picked = files.filter((f) => STARDICT.test(f.name) || /(^|\/)res\//.test(f.webkitRelativePath || ''));
  const ifo = picked.find((f) => /\.ifo$/i.test(f.name));
  if (!ifo) throw new Error('Pick the .ifo, .idx and .dict (or .dict.dz) files, or a zip of them');
  for (const ext of [/\.idx(\.gz)?$/i, /\.dict(\.dz)?$/i]) {
    if (!picked.some((f) => ext.test(f.name))) throw new Error(`A ${ext.source.includes('idx') ? '.idx' : '.dict'} file is missing`);
  }
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of picked) {
    const path = /(^|\/)res\//.test(f.webkitRelativePath || '') ? `res/${f.name}` : f.name;
    entries[`dictionary/${path}`] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }]; // .dz is compressed already
  }
  return { zip: new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), info: parseIfo(await ifo.text()) };
}
