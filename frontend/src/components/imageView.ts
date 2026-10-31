/** The image viewer's geometry: zooming about a point, and keeping the picture on screen. */

/** How a picture sits on screen: scale, and its center's offset from the screen's center */
export interface View { scale: number; x: number; y: number }

const MIN_SCALE = 1;
const MAX_SCALE = 8;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom from `view` to `scale` keeping the point `focus` (relative to the screen's center) where it is */
export function zoomAt(view: View, scale: number, focus: { x: number; y: number }): View {
  const s = clampScale(scale);
  const k = s / view.scale;
  return { scale: s, x: focus.x - (focus.x - view.x) * k, y: focus.y - (focus.y - view.y) * k };
}

/** Keep the picture covering the screen where it's bigger than it, and centered where it's smaller */
export function clampView(view: View, image: { width: number; height: number }, screen: { width: number; height: number }): View {
  const limit = (size: number, room: number) => Math.max(0, (size * view.scale - room) / 2);
  const lx = limit(image.width, screen.width);
  const ly = limit(image.height, screen.height);
  return { scale: view.scale, x: Math.min(lx, Math.max(-lx, view.x)), y: Math.min(ly, Math.max(-ly, view.y)) };
}
