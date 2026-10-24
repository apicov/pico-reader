import type React from 'react';
import type { Settings } from '@/contexts/SettingsContext';
import type { TextSelection } from './selection';

export interface TocItem {
  id: string;
  label: string;
  depth: number;
  /** A part heading: shown, not clickable */
  header?: boolean;
}

/** What every format view gets from the reader page */
export interface ViewProps {
  /** Where to open: a location this view wrote earlier, or (from another format) only the progress */
  initial: { location?: string; progress?: number };
  /** Reading place changed; progress is 0..1 through the whole book */
  onLocation: (location: string, progress: number) => void;
  onToc: (items: TocItem[]) => void;
  onCurrentToc: (id: string | null) => void;
  /** The reader selected text (null: the selection is gone) */
  onSelection: (selection: TextSelection | null) => void;
  settings: Settings;
  vars: React.CSSProperties; // reading CSS variables (readingVars)
  dark: boolean;
}

export interface ViewHandle {
  goToToc: (id: string) => void;
}
