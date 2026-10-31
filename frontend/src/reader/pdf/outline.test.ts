import { entryAt, readOutline } from './outline';

describe('PDF outline', () => {
  it('flattens the entries with their depth, keeping where each points', () => {
    const outline = readOutline([{ title: 'One', dest: 'd1', items: [{ title: 'One.1', dest: [0], items: [] }] },
      { title: 'Two', dest: null, items: [] }]);
    expect(outline.items).toEqual([{ id: 'o0', label: 'One', depth: 0 }, { id: 'o1', label: 'One.1', depth: 1 },
      { id: 'o2', label: 'Two', depth: 0 }]);
    expect(outline.dests.get('o1')).toEqual([0]);
  });

  it('the page being read is under the last entry starting on it or before', () => {
    const pages = [{ id: 'o0', page: 0 }, { id: 'o1', page: 0 }, { id: 'o2', page: 5 }];
    expect(entryAt(pages, 3)).toBe('o1'); // a section starting on the chapter's page wins
    expect(entryAt(pages, 5)).toBe('o2');
    expect(entryAt([{ id: 'o0', page: 2 }], 1)).toBeNull();
  });
});
