/** Each format's viewer: `open` turns the downloaded file into something ready to show; adding a format means an
 *  entry here and in formats.ts (and a location codec in locations.ts). */
import type { Ref, ReactNode } from 'react';
import type { Book, BookFormat } from '@/services/types';
import { EpubView } from './epub/EpubView';
import { PdfView } from './pdf/PdfView';
import { ReflowBundle } from './reflow/bundle';
import { ReflowView } from './reflow/ReflowView';
import type { ViewHandle, ViewProps } from './types';

export interface OpenedBook {
  render(props: ViewProps, ref: Ref<ViewHandle>): ReactNode;
  /** Lets go of what opening took (the reflow bundle's object URLs) */
  close(): void;
}

export const OPEN: Record<BookFormat, (file: Blob, book: Book) => Promise<OpenedBook>> = {
  reflow: async (file) => {
    const bundle = await ReflowBundle.open(file);
    return { render: (props, ref) => <ReflowView key="reflow" ref={ref} bundle={bundle} {...props} />, close: () => bundle.close() };
  },
  epub: async (file, book) => ({
    render: (props, ref) => <EpubView key="epub" ref={ref} blob={file} language={book.language} {...props} />,
    close: () => {},
  }),
  pdf: async (file) => ({
    render: (props, ref) => <PdfView key="pdf" ref={ref} blob={file} {...props} />,
    close: () => {},
  }),
};
