import { Box, Button, IconButton, Paper, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TranslateIcon from '@mui/icons-material/Translate';
import { DictResults } from '@/dict/DictResults';
import type { TextSelection } from './selection';

const isWord = (text: string) => !/\s/.test(text) && text.length <= 48;

/** Under the text while something is selected: one word → its dictionary entries; more → actions. */
export function SelectionPanel({ selection, language, dark, onClose }: {
  selection: TextSelection; language: string; dark: boolean; onClose: () => void;
}) {
  const word = isWord(selection.text);
  return (
    <Paper elevation={8} square sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
      maxHeight: word ? '48%' : 'auto', display: 'flex', flexDirection: 'column',
      borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 1 }}>
        <Typography sx={{ flex: 1, fontFamily: 'Literata, serif', fontWeight: word ? 600 : 400 }} noWrap>
          {word ? selection.text : `“${selection.text}”`}
        </Typography>
        <IconButton size="small" aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(selection.text)}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Close" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      <Box sx={{ overflowY: 'auto', px: 2, pb: 2, pt: 1 }}>
        {word ? (
          <DictResults word={selection.text} language={language} dark={dark} />
        ) : (
          <Button variant="outlined" startIcon={<TranslateIcon />} disabled>Translate (coming next)</Button>
        )}
      </Box>
    </Paper>
  );
}
