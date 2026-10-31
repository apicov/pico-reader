import { chapterPlace, isCfi, pagePlace, placeAt, progressAt } from './locations';

describe('locations', () => {
  it('reads and writes chapters from 0 and pages from 1, both as 0-based places', () => {
    expect(chapterPlace.parse('c3:0.2500')).toEqual({ index: 3, fraction: 0.25 });
    expect(pagePlace.parse('p3:0.2500')).toEqual({ index: 2, fraction: 0.25 });
    expect(pagePlace.format({ index: 2, fraction: 0.25 })).toBe('p3:0.2500');
    expect(chapterPlace.format({ index: 0, fraction: 1 / 3 })).toBe('c0:0.3333');
  });

  it("doesn't read another format's place", () => {
    expect(chapterPlace.parse('p3:0.25')).toBeNull();
    expect(pagePlace.parse('epubcfi(/6/4!/4)')).toBeNull();
    expect(pagePlace.parse(undefined)).toBeNull();
    expect(isCfi('epubcfi(/6/4!/4)') && !isCfi('c1:0.5')).toBe(true);
  });

  it('a progress through the book falls on a place and back', () => {
    expect(placeAt(0.5, 4)).toEqual({ index: 2, fraction: 0 });
    expect(placeAt(1, 4)).toEqual({ index: 3, fraction: 1 }); // the end is the last one's end, not a fifth
    expect(placeAt(0.3, 0)).toEqual({ index: 0, fraction: 0 });
    expect(progressAt({ index: 2, fraction: 0.5 }, 4)).toBe(0.625);
  });
});
