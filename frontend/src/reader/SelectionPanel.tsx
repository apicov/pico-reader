import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import { DictResults } from '@/dict/DictResults';
import type { TextSelection } from './selection';
import { TranslationCard } from './TranslationCard';

const isWord = (text: string) => !/\s/.test(text) && text.length <= 48;

/** One action under the selected text: an icon with its name, sharing the width with the others, big enough to hit
 *  with a thumb (larger on a tablet) */
function Action({ label, name, icon, onClick }: { label: string; name: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Button color="inherit" aria-label={label} onClick={onClick}
      sx={{ flex: 1, maxWidth: { xs: 120, sm: 160 }, minHeight: { xs: 56, sm: 68 }, flexDirection: 'column', gap: 0.5,
        borderRadius: 2, fontSize: { xs: 12, sm: 14 }, fontWeight: 500, color: 'text.secondary',
        '& .MuiSvgIcon-root': { fontSize: { xs: 24, sm: 30 }, color: 'text.primary' } }}>
      {icon}
      {name}
    </Button>
  );
}

/** Under the text while something is selected: one word → its dictionary entries (and its sentence's
 *  translation on request); more → the passage's translation. */
export function SelectionPanel({ selection, language, dark, bookId, location, onClose, onHighlight, onQuote, onSend }: {
  selection: TextSelection; language: string; dark: boolean; bookId: string; location: string; onClose: () => void;
  /** Absent when the selection's place isn't known (it can't be highlighted) */
  onHighlight?: () => void;
  /** Quote the selection in a community post (absent like onHighlight) */
  onQuote?: () => void;
  /** Send it to the reader's study computer (code as code) */
  onSend?: () => void;
}) {
  const word = isWord(selection.text);
  // a word picked from a translation's vocabulary, looked up in place
  const [term, setTerm] = useState<string | null>(null);
  const [sentence, setSentence] = useState(false);
  useEffect(() => { setTerm(null); setSentence(false); }, [selection]);

  const showDict = term ?? (word && !sentence ? selection.text : null);
  const passage = sentence ? selection.context : selection.text;
  return (
    <Paper elevation={8} square sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
      maxHeight: '55%', display: 'flex', flexDirection: 'column',
      borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1, sm: 2 }, pt: 0.5 }}>
        {(term || sentence) && (
          <IconButton aria-label="Back" onClick={() => { setTerm(null); setSentence(false); }}
            sx={{ p: { xs: 1.25, sm: 1.5 } }}>
            <ArrowBackIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
          </IconButton>
        )}
        <Typography sx={{ flex: 1, pl: term || sentence ? 0 : 1, fontFamily: 'Literata, serif', fontSize: { xs: 16, sm: 18 },
          fontWeight: showDict ? 600 : 400 }} noWrap>
          {showDict ?? `“${passage}”`}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ p: { xs: 1.25, sm: 1.5 } }}>
          <CloseIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={{ xs: 0.5, sm: 2 }} sx={{ px: { xs: 1, sm: 2 }, justifyContent: 'space-around',
        borderBottom: 1, borderColor: 'divider' }}>
        {onHighlight && !term && !sentence && (
          <Action label="Highlight" name="Highlight" icon={<BorderColorIcon />} onClick={onHighlight} />
        )}
        {onQuote && !word && !term && !sentence && (
          <Action label="Quote in a post" name="Quote" icon={<ForumOutlinedIcon />} onClick={onQuote} />
        )}
        {onSend && !term && !sentence && (
          <Action label="Send to computer" name="Send" icon={<ComputerOutlinedIcon />} onClick={onSend} />
        )}
        <Action label="Copy" name="Copy" icon={<ContentCopyIcon />}
          onClick={() => void navigator.clipboard?.writeText(showDict ?? passage)} />
      </Stack>
      <Box sx={{ overflowY: 'auto', px: 2, pb: 2, pt: 1.5,
        // the buttons inside (translate, known, review card…): thumb-sized too, apart from each other
        '& .MuiButton-root': { minHeight: { xs: 40, sm: 48 }, px: { xs: 1.5, sm: 2 }, fontSize: { xs: 14, sm: 16 } },
        '& .MuiButton-root + .MuiButton-root': { ml: { xs: 1, sm: 2 } } }}>
        {showDict ? (
          <>
            <DictResults word={showDict} language={language} dark={dark}
              record={term ? undefined : { bookId, location: selection.anchor?.location ?? location, context: selection.context }} />
            {word && !term && selection.context && selection.context !== selection.text && (
              <Button size="small" sx={{ mt: 1 }} onClick={() => setSentence(true)}>Translate the sentence</Button>
            )}
          </>
        ) : (
          <TranslationCard text={passage} context={selection.context} language={language} bookId={bookId}
            location={location} onTerm={setTerm} />
        )}
      </Box>
    </Paper>
  );
}
