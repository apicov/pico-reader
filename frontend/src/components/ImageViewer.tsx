import { useEffect, useRef, useState } from 'react';
import { Box, Dialog, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export interface ViewedImage { src: string; alt: string }

/** How a picture sits on screen: scale, and its center's offset from the screen's center */
export interface View { scale: number; x: number; y: number }

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

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

const START: View = { scale: 1, x: 0, y: 0 };

/** A picture from the book, full screen: pinch or the wheel zooms, dragging moves, a double tap zooms in there (or
 *  back out); ✕, Escape or the back gesture close it. */
export function ImageViewer({ image, onClose }: { image: ViewedImage | null; onClose: () => void }) {
  const [view, setView] = useState<View>(START);
  const screenRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; points: { x: number; y: number }[] } | null>(null);
  const lastTap = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => { setView(START); }, [image?.src]);

  // Android's back button (and the browser's back) closes the picture instead of leaving the book: opening adds a
  // history entry, going back from it closes; closing otherwise takes that entry away again
  const open = !!image;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...window.history.state, imageViewer: true }, '');
    const onPop = () => closeRef.current();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.imageViewer) window.history.back();
    };
  }, [open]);

  /** A point relative to the screen's center */
  const local = (x: number, y: number) => {
    const r = screenRef.current!.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };
  const fit = (v: View): View => {
    const img = imgRef.current;
    const screen = screenRef.current;
    if (!img || !screen) return v;
    return clampView(v, { width: img.clientWidth, height: img.clientHeight },
      { width: screen.clientWidth, height: screen.clientHeight });
  };
  const restart = () => {
    gesture.current = { view: viewRef.current, points: [...pointers.current.values()] };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);  // the moves keep coming when a finger leaves the picture
    } catch { /* a pointer the browser doesn't track (synthetic): moves still arrive over the viewer */ }
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    const now = [...pointers.current.values()];
    const { view: from, points } = gesture.current;
    if (now.length >= 2 && points.length >= 2) {  // pinch: zoom around the fingers' middle, which may move too
      const dist = (p: typeof now) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      const mid = (p: typeof now) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
      const zoomed = zoomAt(from, from.scale * dist(now) / dist(points), mid(points));
      const m0 = mid(points), m1 = mid(now);
      setView(fit({ ...zoomed, x: zoomed.x + m1.x - m0.x, y: zoomed.y + m1.y - m0.y }));
    } else if (now.length === 1 && points.length === 1 && from.scale > 1) {  // drag: move the zoomed picture
      setView(fit({ ...from, x: from.x + now[0].x - points[0].x, y: from.y + now[0].y - points[0].y }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = gesture.current?.points[0];
    const end = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    restart();
    if (pointers.current.size || !start || !end || Math.hypot(end.x - start.x, end.y - start.y) > 10) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {  // a double tap
      lastTap.current = 0;
      setView((v) => (v.scale > 1.05 ? START : fit(zoomAt(v, 2.5, end))));
    } else {
      lastTap.current = now;
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    setView((v) => fit(zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.0015), local(e.clientX, e.clientY))));
  };

  return (
    <Dialog open={!!image} onClose={onClose} fullScreen slotProps={{ paper: { sx: { bgcolor: '#000' } } }}>
      <Box ref={screenRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onWheel={onWheel} data-testid="image-viewer"
        sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}>
        {image && (
          <Box component="img" ref={imgRef} src={image.src} alt={image.alt} draggable={false}
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none', bgcolor: '#fff',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: 'center',
              transition: pointers.current.size ? 'none' : 'transform 0.15s ease-out' }} />
        )}
        <IconButton aria-label="Close" onClick={onClose}
          sx={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 12px)', right: 12, color: '#fff',
            bgcolor: 'rgba(0,0,0,0.55)', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }, p: 1.5 }}>
          <CloseIcon fontSize="large" />
        </IconButton>
      </Box>
    </Dialog>
  );
}
