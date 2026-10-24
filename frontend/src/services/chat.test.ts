import { sseParser } from './chat';

describe('sseParser', () => {
  it('handles events split across chunks', () => {
    const feed = sseParser();
    expect(feed('event: sources\ndata: [{"title":"Die Wol')).toEqual([]);
    expect(feed('ke"}]\n\nevent: delta\ndata: "Uli ist"\n\nevent: del')).toEqual([
      { event: 'sources', data: [{ title: 'Die Wolke' }] },
      { event: 'delta', data: 'Uli ist' },
    ]);
    expect(feed('ta\ndata: " ihr Bruder [1]."\n\n')).toEqual([{ event: 'delta', data: ' ihr Bruder [1].' }]);
  });

  it('accepts CRLF line ends', () => {
    expect(sseParser()('event: done\r\ndata: {"title":"x"}\r\n\r\n')).toEqual([{ event: 'done', data: { title: 'x' } }]);
  });
});
