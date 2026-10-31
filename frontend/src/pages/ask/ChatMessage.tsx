import { useState } from 'react';
import { Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Collapse, Link, Stack, Typography } from '@mui/material';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { Markdown } from '@/components/Markdown';
import { ModelNote } from '@/components/ModelNote';
import type { ChatAction, ChatLink, Message, Passage } from '@/services/chat';
import { READING_FONT, UI_FONT } from '@/theme/readingThemes';

/** The note the agent wants to save, folded until opened, so the reader sees what they confirm */
function NotePreview({ markdown, onCite }: { markdown: string; onCite: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ mb: 1 }}>
      <Button size="small" onClick={() => setOpen(!open)} sx={{ px: 0 }}>{open ? 'Hide the note' : 'Show the note'}</Button>
      {open && (
        <Box sx={{ mt: 1, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 420, overflowY: 'auto' }}>
          <Markdown text={markdown} onCite={onCite} sx={{ fontFamily: READING_FONT, lineHeight: 1.55 }} />
        </Box>
      )}
    </Box>
  );
}

/** The passages an answer cites, folded until opened */
function Sources({ sources, onOpen }: { sources: Passage[]; onOpen: (p: Passage) => void }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Button size="small" color="inherit" onClick={() => setOpen(!open)}
        endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />}
        sx={{ color: 'text.secondary' }}>
        {sources.length} source{sources.length > 1 ? 's' : ''}
      </Button>
      <Collapse in={open}>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {sources.map((p, i) => (
            <Card key={`${p.book_id}-${p.location}-${i}`}>
              <CardActionArea onClick={() => onOpen(p)}>
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Typography variant="caption" color="text.secondary">[{i + 1}] {p.title}{p.heading ? ` · ${p.heading}` : ''}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: READING_FONT, mt: 0.25 }}>
                    {p.text.length > 260 ? `${p.text.slice(0, 260)}…` : p.text}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

/** A question the reader asked */
export function UserBubble({ text }: { text: string }) {
  return (
    <Box sx={{ alignSelf: 'flex-end', maxWidth: '85%', bgcolor: 'action.hover', px: 2, py: 1.25, borderRadius: 3,
      borderBottomRightRadius: 6, whiteSpace: 'pre-wrap' }}>
      {text}
    </Box>
  );
}

/** A change the agent proposed: what it is (a note's text to look at first), and Confirm/Cancel while it waits */
function ActionCard({ action, canDecide, onCite, onDecide }: {
  action: ChatAction; canDecide: boolean; onCite: (n: number) => void; onDecide: (approve: boolean) => void;
}) {
  return (
    <Card sx={{ mt: 1.5, fontFamily: UI_FONT }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="body2" sx={{ mb: action.status === 'pending' ? 1 : 0 }}>{action.label}</Typography>
        {action.preview && <NotePreview markdown={action.preview} onCite={onCite} />}
        {action.status === 'pending' ? (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" disableElevation disabled={!canDecide} onClick={() => onDecide(true)}>Confirm</Button>
            <Button size="small" disabled={!canDecide} onClick={() => onDecide(false)}>Cancel</Button>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {action.status === 'done' ? 'Done ✓' : action.status === 'failed' ? 'Failed' : 'Cancelled'}
            {action.status === 'done' && action.preview && <> · <Link component={RouterLink} to="/notes">Notes</Link></>}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/** An answer: its text (or what the agent is doing while there's none yet), the tools it used, the model, the links
 *  it offers, the changes it proposes and the passages it cites (once complete: not while `streaming`) */
export function AssistantMessage({ message: m, streaming, online, onPassage, onLink, onDecide }: {
  message: Message; streaming: boolean; online: boolean; onPassage: (p: Passage) => void; onLink: (l: ChatLink) => void;
  onDecide: (actionId: string, approve: boolean) => void;
}) {
  const cite = (n: number) => { if (m.sources[n - 1]) onPassage(m.sources[n - 1]); };
  const tools = m.extras?.tools ?? [];
  return (
    <Box sx={{ fontFamily: READING_FONT, fontSize: 17, lineHeight: 1.6 }}>
      {m.content ? <Markdown text={m.content} onCite={cite} /> : (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', fontSize: 14 }}>
          <CircularProgress size={14} />
          <span>{tools.length ? `Using: ${tools.join(', ')}…` : 'Thinking…'}</span>
        </Stack>
      )}
      {tools.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {tools.map((t) => (
            <Chip key={t} size="small" variant="outlined" icon={<BuildCircleOutlinedIcon />} label={t}
              sx={{ fontFamily: 'inherit', color: 'text.secondary' }} />
          ))}
        </Stack>
      )}
      {m.content && <ModelNote models={m.extras?.models} />}
      {m.extras?.links?.length ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          {m.extras.links.map((l, j) => (
            <Button key={j} variant="outlined" size="small" onClick={() => onLink(l)}
              startIcon={l.kind === 'download' ? <FileDownloadOutlinedIcon /> : <MenuBookOutlinedIcon />}>{l.label}</Button>
          ))}
        </Stack>
      ) : null}
      {m.extras?.actions?.map((a) => (
        // not on the provisional message: the action is decided once the answer is stored (it has its id then)
        <ActionCard key={a.id} action={a} canDecide={m.id >= 0 && online} onCite={cite} onDecide={(approve) => onDecide(a.id, approve)} />
      ))}
      {!streaming && <Sources sources={m.sources} onOpen={onPassage} />}
    </Box>
  );
}

