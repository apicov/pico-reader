// foliate-js ships plain JS; the parts of <foliate-view> this app uses
declare module 'foliate-js/view.js' {
  export interface FoliateTocItem { label?: string | null; href?: string | null; subitems?: FoliateTocItem[] | null }
  export interface FoliateRelocate { fraction: number; cfi: string; tocItem?: { label: string; href: string } }
  export interface FoliateView extends HTMLElement {
    book: {
      toc?: FoliateTocItem[]; dir?: string;
      resolveHref?: (href: string) => { index: number; anchor: (doc: Document) => Element | Range | number | null } | null;
      sections: { createDocument?: () => Promise<Document> }[];
    };
    renderer: HTMLElement & { setStyles?: (css: string) => void; next: () => Promise<void>; prev: () => Promise<void> };
    open(book: Blob | File | string): Promise<void>;
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    goLeft(): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    getCFI(index: number, range: Range): string;
    addAnnotation(annotation: { value: string; color?: string }): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    goRight(): Promise<void>;
    close(): void;
    history: { back(): void; canGoBack: boolean };
  }
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
  }
}
