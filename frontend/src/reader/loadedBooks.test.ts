import { nextLoaded } from './loadedBooks';

describe('loaded books', () => {
  it('keeps the order they were loaded in and lets go of the one viewed longest ago', () => {
    expect(nextLoaded(['a', 'b'], ['b', 'a'], 'c', 3)).toEqual(['a', 'b', 'c']);
    // a was viewed last (most recent first: a, c, b): b goes, the others don't move
    expect(nextLoaded(['a', 'b', 'c'], ['a', 'c', 'b'], 'd', 3)).toEqual(['a', 'c', 'd']);
    expect(nextLoaded(['a', 'b', 'c'], ['c', 'b', 'a'], 'b', 3)).toEqual(['a', 'b', 'c']); // already loaded
  });
});
