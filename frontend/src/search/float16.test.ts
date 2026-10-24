import { float16ToFloat32 } from './float16';

it('decodes float16', () => {
  // 1.0 = 0x3c00, -2.0 = 0xc000, 0.5 = 0x3800, 0 = 0x0000, 0.0999755859375 ≈ 0x2e66
  const bytes = new Uint8Array(new Uint16Array([0x3c00, 0xc000, 0x3800, 0x0000, 0x2e66]).buffer);
  const out = float16ToFloat32(bytes);
  expect([...out.slice(0, 4)]).toEqual([1, -2, 0.5, 0]);
  expect(out[4]).toBeCloseTo(0.1, 3);
});
