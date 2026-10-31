import { jumpFromParams, readerPath } from './jump';

describe('reader addresses', () => {
  it('a book alone, or at a place, read back the same', () => {
    expect(readerPath('die wolke/1')).toBe('/read/die%20wolke%2F1');
    const path = readerPath('b1', { format: 'epub', location: 'epubcfi(/6/4!/2)', progress: 0.25 });
    expect(jumpFromParams(new URLSearchParams(path.split('?')[1]))).toEqual({ format: 'epub', location: 'epubcfi(/6/4!/2)', progress: 0.25 });
    expect(jumpFromParams(new URLSearchParams(''))).toBeNull();
  });
});
