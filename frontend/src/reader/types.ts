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
  /** Highlights to show (of the open format) */
  highlights: Highlight[];
  /** Words looked up before, to underline (null: off) */
  seenWords: Set<string> | null;
  /** A picture in the book was tapped: show it large */
  onImage?: (image: { src: string; alt: string }) => void;
  /** false while another page is shown over the open book: keys mustn't turn its pages */
  active?: boolean;
}

export interface Highlight {
  id: string;
  location: string;
  text: string;
  color: string;
}

export interface ViewHandle {
  goToToc: (id: string) => void;
  /** Go to a location this view wrote (or, failing that, a progress through the book) */
  goTo: (location: string, progress: number) => void;
  /** The text of the chapter/section/pages open now */
  currentText: () => string;
}
