import { describe, expect, it, vi } from 'vitest';
import { byOrder, dictPrefs, setDictOrder } from './prefs';

vi.mock('@/services/connectivity', () => ({ isOnline: () => false }));

describe('dictPrefs', () => {
  it('an order set before anything was saved does not stick to the defaults', async () => {
    localStorage.clear();
    await setDictOrder('de', ['duden']);
    localStorage.clear();
    expect((await dictPrefs()).order).toEqual({});
  });
});

describe('byOrder', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  it('puts the listed ones first, in order; the rest keep theirs', () => {
    expect(byOrder(items, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('ignores ids that are not there and works without an order', () => {
    expect(byOrder(items, ['z', 'b']).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(byOrder(items, undefined).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
