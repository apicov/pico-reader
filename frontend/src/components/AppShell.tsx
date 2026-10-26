import type { ReactNode } from 'react';
import { AppBar, Box } from '@mui/material';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <AppBar position="sticky" sx={{ pt: 'env(safe-area-inset-top)' }}>
        <TopBar />
      </AppBar>
      <Box component="main" sx={{ px: { xs: 2, sm: 3 }, py: 3, maxWidth: 1200, mx: 'auto' }}>{children}</Box>
    </Box>
  );
}
