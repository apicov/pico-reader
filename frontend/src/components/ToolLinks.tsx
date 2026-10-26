import { IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import { Link as RouterLink } from 'react-router-dom';

const TOOLS = [
  { to: '/upload', label: 'Add a book', icon: <AddIcon /> },
  { to: '/stats', label: 'Reading statistics', icon: <InsightsOutlinedIcon /> },
  { to: '/community', label: 'Community', icon: <PeopleAltOutlinedIcon /> },
  { to: '/ask', label: 'Ask your library', icon: <QuestionAnswerOutlinedIcon /> },
  { to: '/notes', label: 'Notes', icon: <NoteAltOutlinedIcon /> },
  { to: '/translations', label: 'Translations', icon: <TranslateIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsOutlinedIcon /> },
] as const;

/** The app's tools as icon buttons, the same on every page (TopBar); in a book, a chat started from it asks about
 *  that book. */
export function ToolLinks({ bookId }: { bookId?: string }) {
  return (
    <>
      {TOOLS.map((t) => (
        <Tooltip key={t.to} title={t.label}>
          <IconButton component={RouterLink} to={t.to} aria-label={t.label}
            state={bookId && t.to === '/ask' ? { bookId } : undefined}>
            {t.icon}
          </IconButton>
        </Tooltip>
      ))}
    </>
  );
}
