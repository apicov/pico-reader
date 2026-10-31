import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { getPref, setPref } from '@/services/prefs';
import { SettingsProvider, useSettings } from './SettingsContext';

const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;

describe('SettingsProvider', () => {
  beforeEach(() => localStorage.clear());

  it('loads the saved settings and saves a change', async () => {
    await setPref('settings', { theme: 'night', fontScale: 1.2 });
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.settings.theme).toBe('night'));
    act(() => result.current.update({ fontScale: 1.4 }));
    await waitFor(async () => expect(await getPref('settings')).toMatchObject({ theme: 'night', fontScale: 1.4 }));
  });

  it("a change made before the saved settings loaded doesn't wipe them", async () => {
    await setPref('settings', { theme: 'night', targetLanguage: 'de' });
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.update({ fontScale: 1.4 })); // at once, before the saved ones are read
    await waitFor(async () => expect(await getPref('settings')).toMatchObject({ theme: 'night', targetLanguage: 'de', fontScale: 1.4 }));
    expect(result.current.settings).toMatchObject({ theme: 'night', fontScale: 1.4 });
  });
});
