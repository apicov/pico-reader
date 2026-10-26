import { clampView, zoomAt } from './ImageViewer';

describe('zooming a picture', () => {
  it('keeps the point under the fingers in place', () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: -50 });
    expect(v).toEqual({ scale: 2, x: -100, y: 50 });
    // the point that was at (100, -50) on screen: image point (100, -50) at scale 1 → 2·100 − 100 = 100 again
    expect(2 * 100 + v.x).toBe(100);
  });

  it('stays between 1× and 8×', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.3, { x: 0, y: 0 }).scale).toBe(1);
    expect(zoomAt({ scale: 6, x: 0, y: 0 }, 20, { x: 0, y: 0 }).scale).toBe(8);
  });

  it('can move only as far as the zoomed picture reaches past the screen', () => {
    const image = { width: 400, height: 300 }, screen = { width: 400, height: 800 };
    expect(clampView({ scale: 2, x: 999, y: 999 }, image, screen)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(clampView({ scale: 1, x: 50, y: 50 }, image, screen)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
