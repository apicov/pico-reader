import { useEffect } from 'react';

/** The night theme's colour filter over the whole app: every pixel becomes amber by its brightness and the blue
 *  channel is zero, covers, PDF pages, EPUB images and highlights included. `dim` (0.25–1) darkens it further,
 *  below the phone's lowest brightness. */
export function NightFilter({ on, dim }: { on: boolean; dim: number }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.filter = on ? 'url(#night)' : '';
    return () => { root.style.filter = ''; };
  }, [on]);
  if (!on) return null;
  const r = [0.2126, 0.7152, 0.0722].map((k) => k * dim);
  const g = r.map((k) => k * 0.38);
  const matrix = [...r, 0, 0, ...g, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(' ');
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <filter id="night" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix} />
      </filter>
    </svg>
  );
}
