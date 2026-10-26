/** Manual chapter: Notes (writing, Markdown and diagrams, projects, editing on two sides). */
import NoteAltOutlinedIcon from '@mui/icons-material/NoteAltOutlined';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

export const notes: ManualChapter = {
  id: 'notes',
  title: 'Notes',
  icon: NoteAltOutlinedIcon,
  summary: 'Summaries, outlines and diagrams: written by you, by the chat, or on your computer.',
  sections: [
    {
      id: 'list',
      title: 'Your notes',
      body: (
        <>
          <p>The notes button in the top bar lists your notes, the newest first. They're private: nobody else sees them.
            A book's page shows the notes about that book too.</p>
          <Screenshot name="notes" caption="The notes, filtered by project" />
          <p>With projects on your computer (<ManualLink to="computer.projects">Projects</ManualLink>), chips filter the list:
            <Ui>All</Ui>, each project, <Ui>No project</Ui>.</p>
        </>
      ),
    },
    {
      id: 'making',
      title: 'Three ways to make one',
      body: (
        <>
          <ul>
            <li><strong>Yourself</strong>: <Ui>New note</Ui>, a title and the text (next section), and the project if you have any.</li>
            <li><strong>From the chat</strong>: e.g. <em>"Summarise Die Wolke chapter by chapter as a note, with a map of the
              characters."</em> It proposes <em>Save note</em>; confirm to keep it (<ManualLink to="ask.changes">Changes wait for you</ManualLink>).
              Its <strong>[n]</strong> keep pointing at the passages, also after the chat is gone.</li>
            <li><strong>On your computer</strong>: save a <code>.md</code> file in the notes folder (<ManualLink to="computer.folders">The folders</ManualLink>).</li>
          </ul>
          <Screenshot name="note-new" caption="Writing a note: Markdown, with a preview" />
        </>
      ),
    },
    {
      id: 'markdown',
      title: 'Markdown and diagrams',
      body: (
        <>
          <p>Notes are written in Markdown: <code>## Heading</code>, <code>- list</code>, <code>**bold**</code>,
            <code> `code`</code>, tables. The <Ui>Preview</Ui> tab shows how it will look.</p>
          <p>Diagrams are <code>```mermaid</code> blocks: flowcharts, mind maps, timelines… They're drawn in the note, in the
            colours of your theme. Ask the chat for one ("…with a mind map") if you don't want to write them.</p>
        </>
      ),
    },
    {
      id: 'menu',
      title: 'A note\'s menu (⋮)',
      body: (
        <Controls rows={[
          { label: 'Edit', text: 'Title and Markdown, with a preview. Needs a connection.' },
          { label: 'Project…', text: 'Move it into a project, or out of it. On the computer its file moves along.' },
          { label: 'Export .md', text: 'A file, with the passages it cites listed at the end.' },
          { label: 'Send to computer (copy)', text: 'A copy into an inbox on your computer.' },
          { label: 'Delete…', text: 'From every device. On the computer its file moves to the deleted/ folder.' },
        ]} />
      ),
    },
    {
      id: 'live',
      title: 'Edited in two places',
      body: (
        <>
          <p>A note you're looking at follows changes made elsewhere, e.g. in its file on your computer: within a few seconds
            it shows the new version, with <em>Updated just now</em>.</p>
          <Callout kind="note">
            If you save an edit in the app while the note was changed meanwhile, the app asks: <Ui>Take theirs</Ui> (keep the
            other version) or <Ui>Save mine</Ui> (yours replaces it).
          </Callout>
          <p>Notes are read offline from the device; making or changing one needs a connection.</p>
        </>
      ),
    },
  ],
};
