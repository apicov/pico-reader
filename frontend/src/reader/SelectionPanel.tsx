import { useEffect, useState } from 'react';
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
      <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 1 }}>
        {(term || sentence) && (
          <IconButton size="small" edge="start" aria-label="Back" onClick={() => { setTerm(null); setSentence(false); }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}
        <Typography sx={{ flex: 1, fontFamily: 'Literata, serif', fontWeight: showDict ? 600 : 400 }} noWrap>
          {showDict ?? `“${passage}”`}
        </Typography>
        {onHighlight && !term && !sentence && (
          <IconButton size="small" aria-label="Highlight" onClick={onHighlight}><BorderColorIcon fontSize="small" /></IconButton>
        )}
        {onQuote && !word && !term && !sentence && (
          <IconButton size="small" aria-label="Quote in a post" onClick={onQuote}><ForumOutlinedIcon fontSize="small" /></IconButton>
        )}
        {onSend && !term && !sentence && (
          <IconButton size="small" aria-label="Send to computer" onClick={onSend}><ComputerOutlinedIcon fontSize="small" /></IconButton>
        )}
        <IconButton size="small" aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(showDict ?? passage)}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Close" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      <Box sx={{ overflowY: 'auto', px: 2, pb: 2, pt: 1 }}>
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
