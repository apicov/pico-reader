/**
 * The user manual's content model: chapters are plain data (a title and sections whose body is JSX built from
 * the small pieces in this folder), so the page can list the contents, link to a section and search the text
 * without each chapter doing any of it.
 */
import type { ComponentType, ReactNode } from 'react';

export interface ManualSection {
  /** Stable slug, used in `?s=<chapter>.<section>` links */
  id: string;
  title: string;
  body: ReactNode;
}

export interface ManualChapter {
  /** Stable slug, used in `?s=<chapter>` links */
  id: string;
  title: string;
  icon: ComponentType;
  /** One line under the chapter's title */
  summary: string;
  sections: ManualSection[];
}
