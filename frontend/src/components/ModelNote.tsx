import { Typography } from '@mui/material';

/** "by qwen/qwen3.8-27b" under something the AI wrote: which model answered, "· fallback" when the second AI did
 *  (`via`, or already in a chat's labels; two when the fallback took over midway) */
export function ModelNote({ models, via, sx }: { models: string | string[] | undefined; via?: string; sx?: object }) {
  const names = (Array.isArray(models) ? models : [models]).filter((m): m is string => !!m)
    .map((m) => (via === 'fallback' ? `${m} · fallback` : m));
  if (!names.length) return null;
  return (
    <Typography variant="caption" color="text.secondary" component="div" data-testid="model-note"
      sx={{ fontFamily: 'Inter, sans-serif', opacity: 0.8, mt: 1, ...sx }}>
      by {names.join(' → ')}
    </Typography>
  );
}
