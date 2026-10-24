// foliate-js ships plain JS; the parts of <foliate-view> this app uses
declare module 'foliate-js/view.js' {
  export interface FoliateTocItem { label: string; href: string; subitems?: FoliateTocItem[] }
  export interface FoliateRelocate { fraction: number; cfi: string; tocItem?: { label: string; href: string } }
  export interface FoliateView extends HTMLElement {
    book: { toc?: FoliateTocItem[]; dir?: string };
    renderer: HTMLElement & { setStyles?: (css: string) => void; next: () => Promise<void>; prev: () => Promise<void> };
    open(book: Blob | File | string): Promise<void>;
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    goLeft(): Promise<void>;
    getCFI(index: number, range: Range): string;
    addAnnotation(annotation: { value: string; color?: string }): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    goRight(): Promise<void>;
    close(): void;
  }
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
  }
}
