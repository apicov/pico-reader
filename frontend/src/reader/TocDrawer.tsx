import { useState } from 'react';
import { Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Tab, Tabs, Typography } from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditNoteIcon from '@mui/icons-material/EditNote';
import type { Annotation } from '@/services/annotations';
import type { TocItem } from './types';

const FORMAT_LABEL: Record<string, string> = { reflow: 'Text', epub: 'EPUB', pdf: 'PDF' };

/** Contents and notes (highlights + bookmarks) of the open book. */
export function TocDrawer({ open, onClose, title, items, current, onPick, annotations, onAnnotation, onEditNote, onDelete }: {
  open: boolean; onClose: () => void; title: string; items: TocItem[]; current: string | null;
  onPick: (id: string) => void;
  annotations: Annotation[];
  onAnnotation: (a: Annotation) => void;
  onEditNote: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
}) {
  const [tab, setTab] = useState<'contents' | 'notes'>('contents');
  const formats = new Set(annotations.map((a) => a.format));
  return (
    <Drawer open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 340, maxWidth: '88vw' } } }}>
      <Typography variant="h6" sx={{ px: 2, pt: 'calc(env(safe-area-inset-top) + 16px)' }} noWrap>{title}</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="contents" label="Contents" />
        <Tab value="notes" label={`Notes${annotations.length ? ` (${annotations.length})` : ''}`} />
      </Tabs>
      {tab === 'contents' ? (
        <List dense>
          {items.length === 0 && <ListSubheader disableSticky>This book has no table of contents.</ListSubheader>}
          {items.map((item) => item.header ? (
            <ListSubheader key={item.id} disableSticky sx={{ bgcolor: 'transparent' }}>{item.label}</ListSubheader>
          ) : (
            <ListItemButton key={item.id} selected={item.id === current} sx={{ pl: 2 + item.depth * 2 }}
              onClick={() => { onPick(item.id); onClose(); }}>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      ) : (
        <List dense>
          {annotations.length === 0 && (
            <ListSubheader disableSticky sx={{ lineHeight: 1.5, py: 2 }}>
              Select text and tap the highlighter, or tap the bookmark in the top bar.
            </ListSubheader>
          )}
          {annotations.map((a) => (
            <ListItemButton key={a.id} alignItems="flex-start" onClick={() => { onAnnotation(a); onClose(); }}>
              <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                {a.kind === 'bookmark' ? <BookmarkIcon fontSize="small" /> : <BorderColorIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={a.kind === 'bookmark' ? (a.text || 'Bookmark') : `“${a.text.length > 160 ? `${a.text.slice(0, 160)}…` : a.text}”`}
                secondary={<>
                  {a.note && <Box component="span" sx={{ display: 'block', fontStyle: 'italic' }}>{a.note}</Box>}
                  {Math.round(a.progress * 100)}%{formats.size > 1 ? ` · ${FORMAT_LABEL[a.format] ?? a.format}` : ''}
                </>}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', ml: 0.5 }} onClick={(e) => e.stopPropagation()}>
                <IconButton size="small" aria-label="Note" onClick={() => onEditNote(a)}><EditNoteIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label="Delete" onClick={() => onDelete(a)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Box>
            </ListItemButton>
          ))}
        </List>
      )}
    </Drawer>
  );
}
