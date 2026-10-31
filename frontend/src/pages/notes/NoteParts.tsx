import { useState, type ReactNode } from 'react';
import { Box, Button, Card, CardActionArea, CardContent, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import type { Note } from '@/services/notes';
import { READING_FONT } from '@/theme/readingThemes';
import { markdownSnippet } from '@/utils/text';
import { noteDay } from './noteText';
import { useNotes } from './useNotes';

/** Notes as cards: title, where it belongs (`showBook`), when, its first words */
export function NoteCards({ notes, showBook }: { notes: Note[]; showBook: boolean }) {
  return (
    <Stack spacing={1.5}>
      {notes.map((n) => (
        <Card key={n.id}>
          <CardActionArea component={RouterLink} to={`/notes/${encodeURIComponent(n.id)}`}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography sx={{ fontFamily: READING_FONT, fontWeight: 600 }}>{n.title}</Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {showBook && n.project ? `${n.project} · ` : ''}{showBook && n.book_title ? `${n.book_title} · ` : ''}{noteDay(n.updated_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} noWrap>{markdownSnippet(n.markdown)}</Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

/** "My notes" on a book's page */
export function BookNotes({ bookId }: { bookId: string }) {
  const notes = useNotes(bookId);
  if (!notes?.length) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>My notes</Typography>
      <NoteCards notes={notes} showBook={false} />
    </Box>
  );
}

/** Title and Markdown, with a preview: editing a note, or writing a new one */
export function NoteEditor({ draft, onChange, canSave, onSave, onCancel, onCite, children }: {
  draft: { title: string; markdown: string }; onChange: (d: { title: string; markdown: string }) => void;
  canSave: boolean; onSave: () => void; onCancel: () => void; onCite?: (n: number) => void; children?: ReactNode;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  return (
    <Stack spacing={1.5}>
      <TextField label="Title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      {children}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="edit" label="Markdown" />
        <Tab value="preview" label="Preview" />
      </Tabs>
      {tab === 'edit'
        ? <TextField multiline minRows={14} value={draft.markdown} onChange={(e) => onChange({ ...draft, markdown: e.target.value })}
            slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 14 } }, htmlInput: { 'aria-label': 'Markdown' } }} />
        : <Markdown text={draft.markdown} onCite={onCite ?? (() => undefined)} sx={{ fontFamily: READING_FONT, lineHeight: 1.6 }} />}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" disableElevation disabled={!canSave || !draft.title.trim()} onClick={onSave}>Save</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Stack>
    </Stack>
  );
}
