import { Box, Popover, Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography, FormControlLabel } from '@mui/material';
import { useSettings, type Settings } from '@/contexts/SettingsContext';
import { READING_THEMES, type ReadingThemeName } from '@/theme/readingThemes';

/** Night theme brightness: goes below the phone's lowest setting */
export function NightDim() {
  const { settings, update } = useSettings();
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">Night brightness</Typography>
      <Slider size="small" min={0.25} max={1} step={0.05} value={settings.nightDim}
        onChange={(_, v) => update({ nightDim: v as number })} />
    </Box>
  );
}

/** The "Aa" panel: theme, text size, spacing, margins. */
export function ReadingSettings({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { settings, update } = useSettings();
  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Stack spacing={2} sx={{ p: 2, width: 300 }}>
        <Stack direction="row" spacing={1}>
          {(Object.keys(READING_THEMES) as ReadingThemeName[]).map((name) => {
            const t = READING_THEMES[name];
            return (
              <Box key={name} component="button" aria-label={t.label} aria-pressed={settings.theme === name}
                onClick={() => update({ theme: name })}
                sx={{ flex: 1, height: 44, borderRadius: 1.5, cursor: 'pointer', bgcolor: t.swatch?.background ?? t.background, color: t.swatch?.text ?? t.text,
                  border: 2, borderColor: settings.theme === name ? 'primary.main' : t.divider, fontFamily: 'Literata, serif' }}>
                Aa
              </Box>
            );
          })}
        </Stack>
        {settings.theme === 'night' && <NightDim />}
        <Box>
          <Typography variant="caption" color="text.secondary">Text size</Typography>
          <Slider size="small" min={0.8} max={1.6} step={0.05} value={settings.fontScale}
            onChange={(_, v) => update({ fontScale: v as number })} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Line spacing</Typography>
          <Slider size="small" min={1.3} max={2.1} step={0.05} value={settings.lineHeight}
            onChange={(_, v) => update({ lineHeight: v as number })} />
        </Box>
        <ToggleButtonGroup exclusive size="small" fullWidth value={settings.margin}
          onChange={(_, v: Settings['margin'] | null) => v && update({ margin: v })}>
          <ToggleButton value="narrow">Narrow</ToggleButton>
          <ToggleButton value="normal">Normal</ToggleButton>
          <ToggleButton value="wide">Wide</ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel control={<Switch checked={settings.justify} onChange={(e) => update({ justify: e.target.checked })} />}
          label="Justify text" />
        <FormControlLabel control={<Switch checked={settings.markLookedUp} onChange={(e) => update({ markLookedUp: e.target.checked })} />}
          label="Underline words I looked up" />
      </Stack>
    </Popover>
  );
}
