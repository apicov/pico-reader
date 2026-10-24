import type { ReactNode } from 'react';
import { AppBar, Box, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import AddIcon from '@mui/icons-material/Add';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { READING_FONT } from '@/theme/readingThemes';

export function AppShell({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <AppBar position="sticky" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <Toolbar>
          <Typography component={RouterLink} to="/" variant="h6"
            sx={{ flexGrow: 1, fontFamily: READING_FONT, color: 'inherit', textDecoration: 'none' }}>
            Library
          </Typography>
          {!online && (
            <Tooltip title="Offline: downloaded books still open">
              <CloudOffOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mr: 1 }} />
            </Tooltip>
          )}
          <IconButton component={RouterLink} to="/upload" aria-label="Add a book">
            <AddIcon />
          </IconButton>
          <IconButton component={RouterLink} to="/stats" aria-label="Reading statistics">
            <InsightsOutlinedIcon />
          </IconButton>
          <IconButton component={RouterLink} to="/community" aria-label="Community">
            <PeopleAltOutlinedIcon />
          </IconButton>
          <IconButton component={RouterLink} to="/ask" aria-label="Ask your library">
            <QuestionAnswerOutlinedIcon />
          </IconButton>
          <IconButton component={RouterLink} to="/translations" aria-label="Translations">
            <TranslateIcon />
          </IconButton>
          <IconButton component={RouterLink} to="/settings" aria-label="Settings" edge="end">
            <SettingsOutlinedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ px: { xs: 2, sm: 3 }, py: 3, maxWidth: 1200, mx: 'auto' }}>{children}</Box>
    </Box>
  );
}
