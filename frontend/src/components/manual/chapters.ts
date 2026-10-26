/** The user manual's chapters, in reading order. A chapter added here is in the contents and the search. */
import type { ManualChapter } from './types';
import { findingYourWay, gettingStarted } from './content/basics';
import { library } from './content/library';
import { reading, selecting, themes } from './content/reading';
import { words } from './content/words';
import { ask } from './content/ask';
import { notes } from './content/notes';
import { computer } from './content/computer';
import { adding, community, offline, settingsChapter, stats } from './content/more';

export const MANUAL_CHAPTERS: ManualChapter[] = [
  gettingStarted,
  findingYourWay,
  library,
  reading,
  themes,
  selecting,
  words,
  ask,
  notes,
  computer,
  stats,
  community,
  adding,
  offline,
  settingsChapter,
];
