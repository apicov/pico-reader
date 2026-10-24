import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { parseIfo, stardictZip } from './stardict';

const IFO = "StarDict's dict ifo file\nversion=2.4.2\nbookname=Mini Wörterbuch\nwordcount=2\nsametypesequence=m\n";
const file = (name: string, text: string) => new File([text], name);

describe('stardict uploads', () => {
  it('reads the name and size from the .ifo', () => {
    expect(parseIfo(IFO)).toEqual({ name: 'Mini Wörterbuch', wordcount: 2 });
  });

  it('zips loose files', async () => {
    const { zip, info } = await stardictZip([file('mini.ifo', IFO), file('mini.idx', 'i'), file('mini.dict.dz', 'd'), file('notes.txt', 'x')]);
    expect(info.name).toBe('Mini Wörterbuch');
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer()))).sort())
      .toEqual(['dictionary/mini.dict.dz', 'dictionary/mini.idx', 'dictionary/mini.ifo']);
  });

  it('takes a zip as it is', async () => {
    // made by the loose-files path: fflate's own Uint8Arrays fail its instanceof checks in jsdom
    const { zip } = await stardictZip([file('mini.ifo', IFO), file('mini.idx', 'i'), file('mini.dict', 'd')]);
    const { info } = await stardictZip([new File([zip], 'mini.zip')]);
    expect(info.wordcount).toBe(2);
  });

  it('says what is missing', async () => {
    await expect(stardictZip([file('mini.ifo', IFO), file('mini.idx', 'i')])).rejects.toThrow('.dict');
    await expect(stardictZip([file('mini.idx', 'i')])).rejects.toThrow('.ifo');
  });
});
