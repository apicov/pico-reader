/** Manual chapters: Reading · Text and themes · Selecting text. */
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import FormatSizeIcon from '@mui/icons-material/FormatSize';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import TocIcon from '@mui/icons-material/Toc';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

export const reading: ManualChapter = {
  id: 'reading',
  title: 'Reading',
  icon: MenuBookOutlinedIcon,
  summary: 'Turning pages, the reader\'s bar, contents, bookmarks and highlights.',
  sections: [
    {
      id: 'open',
      title: 'Opening a book',
      body: (
        <>
          <p>Tap a book in the library. The first time, it downloads (a bar shows how far); after that it opens at once,
            also offline, at the place you left it, on any of your devices.</p>
          <Screenshot name="reader" caption="Reading an EPUB on a phone" />
          <p>A book can come in up to three formats:</p>
          <ul>
            <li><strong>EPUB</strong>: pages that reflow to the screen, turned left and right.</li>
            <li><strong>PDF</strong>: the printed pages, scrolled; on a dark theme they're shown light on dark.</li>
            <li><strong>Text</strong>: a clean text version (often made from a PDF), scrolled chapter by chapter, with
              formulas and code shown properly.</li>
          </ul>
          <p>When a book has several, <Ui>⇄ EPUB</Ui> in the bar switches between them; the app remembers your choice per book.</p>
        </>
      ),
    },
    {
      id: 'pages',
      title: 'Turning pages',
      body: (
        <>
          <ul>
            <li><strong>EPUB</strong>: tap the right edge of the page to go on, the left edge to go back, or swipe. The middle
              of the page stays free for selecting text. With a keyboard: the arrow keys, Page Down or the space bar.</li>
            <li><strong>PDF and Text</strong>: scroll. In Text, the end of a chapter has buttons to the previous and next one.</li>
          </ul>
          <Callout kind="tip">Your place is saved as you read and sent to your other devices when online.</Callout>
        </>
      ),
    },
    {
      id: 'bar',
      title: 'The reader\'s bar',
      body: (
        <>
          <Controls rows={[
            { icon: <ArrowBackIcon />, label: 'Back', text: 'To the library.' },
            { icon: <SwapHorizIcon />, label: 'Format', text: 'Another format of the book (only when it has several).' },
            { icon: <BookmarkBorderIcon />, label: 'Bookmark', text: 'Bookmark this place, or remove the bookmark that\'s here.' },
            { icon: <TocIcon />, label: 'Contents', text: 'The chapters, your highlights and bookmarks, and the words you looked up (next section).' },
            { icon: <FormatSizeIcon />, label: 'Text settings', text: <>Theme, text size, spacing, margins (<ManualLink to="themes">Text and themes</ManualLink>).</> },
          ]} />
        </>
      ),
    },
    {
      id: 'pictures',
      title: 'Pictures',
      body: (
        <>
          <p>Tap a picture in an EPUB or Text book to see it full screen:</p>
          <ul>
            <li><strong>Zoom</strong>: pinch with two fingers, or double-tap where you want to look closer (double-tap again
              to see all of it). With a mouse: the wheel.</li>
            <li><strong>Move</strong> around a zoomed picture by dragging it.</li>
            <li><strong>Close</strong>: ✕ at the top, or the phone's back button.</li>
          </ul>
          <p>PDF pages zoom with two fingers right on the page.</p>
        </>
      ),
    },
    {
      id: 'contents',
      title: 'Contents, highlights and words',
      body: (
        <>
          <p>The contents button opens a panel with three tabs:</p>
          <ul>
            <li><Ui>Contents</Ui>: the chapters; tap one to go there. The one you're in is marked.</li>
            <li><Ui>Notes</Ui>: your highlights and bookmarks in this book. Tap one to go to it. Each has buttons to add a
              note to it, share it in a post, send it to your computer, or delete it.</li>
            <li><Ui>Words</Ui>: words in this chapter you looked up before and haven't marked as known. Tap one to look it
              up again.</li>
          </ul>
          <Screenshot name="contents-notes" caption="The Notes tab: highlights and bookmarks of the book" />
        </>
      ),
    },
  ],
};

export const themes: ManualChapter = {
  id: 'themes',
  title: 'Text and themes',
  icon: FormatSizeIcon,
  summary: 'Size, spacing, margins and colours, including a night theme without blue light.',
  sections: [
    {
      id: 'text',
      title: 'Text settings',
      body: (
        <>
          <p>Tap <FormatSizeIcon fontSize="inherit" /> in the reader's bar:</p>
          <Screenshot name="text-settings" caption="The text settings" device="detail" />
          <ul>
            <li>The five themes (next section).</li>
            <li><strong>Text size</strong> and <strong>Line spacing</strong>: sliders.</li>
            <li>Margins: <Ui>Narrow</Ui>, <Ui>Normal</Ui>, <Ui>Wide</Ui>.</li>
            <li><strong>Justify text</strong>: straight right edges, with hyphenation.</li>
            <li><strong>Underline words I looked up</strong>: a dotted line under words you looked up before, so you notice
              them coming back.</li>
          </ul>
          <p>The settings are the same for every book, and kept on this device: a phone and a tablet can each have their own.</p>
        </>
      ),
    },
    {
      id: 'themes',
      title: 'Paper, Sepia, Dark, Black and Night',
      body: (
        <>
          <ul>
            <li><strong>Paper</strong> and <strong>Sepia</strong>: dark text on a light page.</li>
            <li><strong>Dark</strong> and <strong>Black</strong>: light text on dark grey or pure black (black saves battery on
              phones with an OLED screen).</li>
            <li><strong>Night</strong>: for reading in bed. Everything turns amber on black, with no blue light at all: covers,
              PDF pages and pictures too. <strong>Night brightness</strong> dims below the phone's lowest brightness.</li>
          </ul>
          <Screenshot name="night" caption="The Night theme: amber on black" />
          <p>The theme applies to the whole app, not only the book. It's also in Settings.</p>
        </>
      ),
    },
  ],
};

export const selecting: ManualChapter = {
  id: 'select',
  title: 'Selecting text',
  icon: HighlightAltIcon,
  summary: 'Look up a word, translate a passage, highlight, quote, send and copy.',
  sections: [
    {
      id: 'panel',
      title: 'The panel under the text',
      body: (
        <>
          <p>Long-press a word, or drag over a passage. A panel opens at the bottom of the screen:</p>
          <Screenshot name="selection" caption="A selected passage: its actions and the translation" />
          <Controls rows={[
            { icon: <BorderColorIcon />, label: 'Highlight', text: 'Mark it; it\'s kept in the book\'s Notes tab.' },
            { icon: <ForumOutlinedIcon />, label: 'Quote', text: <>Start a community post quoting it (<ManualLink to="community.posts">Posts</ManualLink>).</> },
            { icon: <ComputerOutlinedIcon />, label: 'Send', text: <>To your study computer (<ManualLink to="computer.send">Sending</ManualLink>). Code is sent as code.</> },
            { icon: <ContentCopyIcon />, label: 'Copy', text: 'To the clipboard.' },
          ]} />
          <p>✕ closes the panel. In the Android app, the phone's own menu over the selection (Copy, Share…) doesn't
            appear: the panel has all of it.</p>
        </>
      ),
    },
    {
      id: 'word',
      title: 'One word: the dictionary',
      body: (
        <>
          <p>A single word shows its entries from the dictionaries installed on this device, in the book's language. An
            inflected word is also tried in its dictionary forms (<em>Häuser</em> → <em>Haus</em>, <em>hablando</em> →
            <em> hablar</em>), and similar words are suggested when nothing matches. It works offline.</p>
          <ul>
            <li>The ★ next to a dictionary puts it first from now on.</li>
            <li>No dictionary has the word? The AI explains it, marked <em>AI · not in your dictionaries</em> (needs a connection).</li>
            <li><Ui>I know this</Ui> marks the word as known: it isn't underlined or offered for review any more.</li>
            <li><Ui>Add to review</Ui> makes a review card of it (<ManualLink to="words.review">Review</ManualLink>).</li>
            <li><Ui>Translate the sentence</Ui> translates the sentence around the word.</li>
          </ul>
          <Callout kind="note">Install dictionaries first: Settings → <Ui>Manage dictionaries</Ui> (<ManualLink to="words.dictionaries">Dictionaries</ManualLink>).</Callout>
        </>
      ),
    },
    {
      id: 'passage',
      title: 'A passage: the translation',
      body: (
        <>
          <p>More than one word shows <Ui>Translate into …</Ui>. The translation comes with notes and the passage's
            vocabulary; tap a word of the vocabulary to look it up, or add it to your review cards. A grey line under it
            says which AI model translated it (also under a word the AI explained).</p>
          <p>Translations are kept: the same passage translates at once the next time, and every translation is on the
            <ManualLink to="words.translations"> Translations</ManualLink> page. The language you translate into is in Settings.</p>
        </>
      ),
    },
  ],
};
