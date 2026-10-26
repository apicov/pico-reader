/** The pieces manual sections are made of: a screenshot, a tip box, a link to another section, a button's name as
 *  it looks in the app, and "icon · name · what it does" rows. */
import { useState, type ReactNode } from 'react';
import { Box, Dialog, IconButton, Link } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import { Link as RouterLink } from 'react-router-dom';

/** A picture of a real screen, `public/manual/<name>.webp` (made by e2e/manual/capture.py). Tap for full size;
 *  a picture not captured yet shows as a labelled placeholder. */
export function Screenshot({ name, caption, device = 'phone' }: {
  name: string; caption: string; device?: 'phone' | 'tablet' | 'detail';
}) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const src = `${import.meta.env.BASE_URL}manual/${name}.webp`;
  const width = { phone: 300, tablet: 640, detail: 420 }[device];
  return (
    <Box component="figure" sx={{ m: 0, my: 2, maxWidth: width, width: '100%' }}>
      {failed ? (
        <Box role="img" aria-label={caption} sx={{ border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 2,
          p: 3, color: 'text.secondary', display: 'flex', gap: 1, alignItems: 'center', fontSize: 14 }}>
          <ImageNotSupportedOutlinedIcon fontSize="small" /> Picture coming soon
        </Box>
      ) : (
        <Box component="button" type="button" onClick={() => setZoomed(true)} aria-label={`Enlarge: ${caption}`}
          sx={{ p: 0, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', cursor: 'zoom-in',
            display: 'block', width: '100%', bgcolor: 'transparent' }}>
          <Box component="img" src={src} alt={caption} loading="lazy" decoding="async" onError={() => setFailed(true)}
            sx={{ display: 'block', width: '100%', height: 'auto' }} />
        </Box>
      )}
      <Box component="figcaption" sx={{ mt: 0.75, fontSize: 13, color: 'text.secondary' }}>{caption}</Box>
      <Dialog open={zoomed} onClose={() => setZoomed(false)} maxWidth={false}>
        <IconButton aria-label="Close" onClick={() => setZoomed(false)}
          sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}>
          <CloseIcon />
        </IconButton>
        <Box component="img" src={src} alt={caption} sx={{ display: 'block', maxWidth: '92vw', maxHeight: '88vh' }} />
      </Dialog>
    </Box>
  );
}

const TITLES = { tip: 'Tip', note: 'Good to know', warn: 'Watch out' } as const;

/** A highlighted box: a tip, something good to know, or a warning */
export function Callout({ kind = 'tip', children }: { kind?: keyof typeof TITLES; children: ReactNode }) {
  const colour = { tip: 'success.main', note: 'primary.main', warn: 'warning.main' }[kind];
  return (
    <Box component="aside" sx={{ my: 2, p: 1.5, pl: 2, borderLeft: 4, borderColor: colour, bgcolor: 'action.hover',
      borderRadius: 1, '& p': { my: 0.5 } }}>
      <Box component="strong" sx={{ display: 'block', mb: 0.5, color: colour }}>{TITLES[kind]}</Box>
      <div>{children}</div>
    </Box>
  );
}

/** A link to another part of the manual: `to="reading"` or `"reading.select"` */
export function ManualLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link component={RouterLink} to={`/manual?s=${to}`} replace>{children}</Link>;
}

/** A button's or menu item's name, looking like it does in the app */
export function Ui({ children }: { children: ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-block', px: 0.75, py: 0.1, mx: 0.25, border: 1, borderColor: 'divider',
      borderRadius: 1, fontSize: '0.9em', fontWeight: 600, whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
      {children}
    </Box>
  );
}

export interface ControlRow { icon?: ReactNode; label: ReactNode; text: ReactNode }

/** "icon · name · what it does", e.g. the buttons of a toolbar */
export function Controls({ rows }: { rows: ControlRow[] }) {
  return (
    <Box role="list" sx={{ my: 2, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {rows.map((row, i) => (
        <Box role="listitem" key={i} sx={{ display: 'flex', gap: 1.5, p: 1.25, alignItems: 'flex-start',
          borderTop: i ? 1 : 0, borderColor: 'divider' }}>
          <Box sx={{ width: 28, flexShrink: 0, display: 'flex', justifyContent: 'center', pt: 0.25, color: 'text.secondary' }}>
            {row.icon}
          </Box>
          <div>
            <Box sx={{ fontWeight: 600 }}>{row.label}</Box>
            <Box sx={{ color: 'text.secondary', fontSize: 15 }}>{row.text}</Box>
          </div>
        </Box>
      ))}
    </Box>
  );
}
