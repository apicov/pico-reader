import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { computerStatus, type ComputerStatus } from '@/services/computer';
import { loadProjects, type Project } from '@/services/projects';

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 120) return `${minutes} minutes ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} hours ago`;
  return new Date(iso).toLocaleDateString();
}

/** The study computer: when it last synced, what waits for it, how to set it up */
export function ComputerSettings() {
  const online = useOnlineStatus();
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { if (online) void computerStatus().then(setStatus).catch(() => undefined); }, [online]);
  useEffect(() => { void loadProjects().then(setProjects); }, [online]);
  const code = { fontFamily: 'ui-monospace, monospace', fontSize: 13, bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1, display: 'block', my: 0.5 };
  return (
    <Box>
      <Typography variant="h6">Computer</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        What you send to your computer (the computer button on selected text or a highlight, or a note's menu) arrives
        as files in <b>~/pico/inbox</b>, code as source files; files you
        save in <b>~/pico/outbox</b> become notes here; your notes are kept in <b>~/pico/notes</b> as .md files, both
        ways, within seconds.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        <b>Projects</b>: a folder there with its own <b>notes/</b> and <b>inbox/</b>. A note in a project lives in
        that folder; you pick the project when sending.
        {projects.length ? ` Yours: ${projects.map((p) => p.name).join(', ')}.` : ''}
      </Typography>
      {status && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          {status.seen_at ? `Last synced ${ago(status.seen_at)}` : 'No computer has synced yet'}
          {status.waiting ? ` · ${status.waiting} waiting for it` : ''}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">On the computer, with the desktop tool (tools/README):</Typography>
      <Box component="code" sx={code}>reader login you@example.com</Box>
      <Box component="code" sx={code}>reader sync --install</Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>And in a project's folder:</Typography>
      <Box component="code" sx={code}>reader project add</Box>
    </Box>
  );
}
