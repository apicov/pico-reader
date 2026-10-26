/** Manual chapter: The study computer (setting it up, the folders, sending, the running file, projects). */
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import type { ManualChapter } from '../types';
import { Callout, Controls, ManualLink, Screenshot, Ui } from '../parts';

const code = { fontFamily: 'ui-monospace, monospace' } as const;

export const computer: ManualChapter = {
  id: 'computer',
  title: 'The study computer',
  icon: ComputerOutlinedIcon,
  summary: 'Highlights and code to a folder on your Linux computer, and notes kept there as files, both ways.',
  sections: [
    {
      id: 'setup',
      title: 'Setting it up',
      body: (
        <>
          <p>For studying on a computer with a terminal and an editor: what you send from the app arrives there as plain files,
            and files you save there reach the app. A small program on the computer does it, the desktop tool
            (<code>tools/</code> in the project). On the computer:</p>
          <pre style={code}>{`cd tools
./reader login you@example.com              # emails a code
./reader login you@example.com --code 123456
./reader sync --install                      # runs in the background from now on`}</pre>
          <p>It keeps the folder <code>~/pico</code> in step with the app, and starts by itself when you log in. Settings →
            <em> Computer</em> in the app shows when it last synced.</p>
          <Callout kind="tip">See what it does: <code>journalctl --user -u pico-reader-sync -f</code>. Stop it for good:
            <code> ./reader sync --uninstall</code>.</Callout>
        </>
      ),
    },
    {
      id: 'folders',
      title: 'The folders',
      body: (
        <Controls rows={[
          { label: '~/pico/inbox/', text: 'What you send from the app: highlights as Markdown (with the book and chapter), code as a real source file (.py, .rs…) with its language. Or added to the end of journal.md (next sections).' },
          { label: '~/pico/outbox/', text: 'A .md or .txt saved here becomes a note in the app, then moves to outbox/sent/. A title: line at the top sets its title.' },
          { label: '~/pico/notes/', text: 'Your notes as .md files, kept in step both ways within seconds: edit them in your editor or in the app. A new file here becomes a new note.' },
        ]} />
      ),
    },
    {
      id: 'send',
      title: 'Sending from the app',
      body: (
        <>
          <p>Tap <Ui>Send</Ui> under selected text, the computer button on a highlight (the book's Notes tab), or a note's
            <Ui>Send to computer (copy)</Ui>. A window asks two things, and remembers both:</p>
          <ul>
            <li><strong>How</strong>: <Ui>Running file</Ui> adds it to the end of the inbox's <code>journal.md</code>;
              <Ui>New file</Ui> makes a file of its own.</li>
            <li><strong>Where</strong>: the <Ui>Inbox</Ui> (<code>~/pico/inbox</code>) or one of your projects.</li>
          </ul>
          <Screenshot name="send" caption="Where to send it, and how" />
          <p>Code selected inside a code block is sent as code, with its language. Offline, it waits and goes when you're
            back online. The chat can send too: <em>"send the code from chapter 3 to my computer"</em>.</p>
        </>
      ),
    },
    {
      id: 'journal',
      title: 'The running file',
      body: (
        <>
          <p><code>journal.md</code> collects everything sent to the running file, the newest at the end, each under a line
            saying when and from where:</p>
          <pre style={code}>{`## 2026-10-26 14:12 · Fluent Python · 2 Lists · code (python)

\`\`\`python
squares = [x * x for x in range(10)]
\`\`\``}</pre>
          <p>Keep it open in your editor while you study, and everything you send shows up there.</p>
          <Callout kind="warn">Editors reload a file that changed on disk when you come back to it (in Vim/LazyVim
            <code> :checktime</code> reloads now). Don't keep unsaved edits in journal.md: saving them would overwrite what
            arrived meanwhile (Vim warns you first).</Callout>
        </>
      ),
    },
    {
      id: 'projects',
      title: 'Projects',
      body: (
        <>
          <p>A project is a folder on the computer with its own <code>notes/</code> and <code>inbox/</code>, so everything for
            it stays together:</p>
          <pre style={code}>{`cd ~/code/rust-book
reader project add          # this folder becomes the project “rust-book”
reader project list
reader project remove       # stop syncing it (its files stay)`}</pre>
          <ul>
            <li>A note in a project lives in that project's <code>notes/</code>; other notes stay in <code>~/pico/notes</code>.</li>
            <li>Moving a note to a project in the app (⋮ → <Ui>Project…</Ui>) moves its file; moving the file between those
              folders moves the note.</li>
            <li>Sending, pick the project: it lands in its <code>inbox/</code> (or its <code>journal.md</code>).</li>
            <li>In the app, notes are filtered by project (<ManualLink to="notes.list">Your notes</ManualLink>).</li>
          </ul>
        </>
      ),
    },
    {
      id: 'rules',
      title: 'Good to know',
      body: (
        <ul>
          <li>Deleting a note's file doesn't delete the note: it comes back. Delete notes in the app; the file then moves to
            <code> deleted/</code>.</li>
          <li>Changed on both sides at once: the app's version is kept, and yours is saved in <code>conflicts/</code>.</li>
          <li>The sources of a note from the chat are listed at its end, below a marker line; that part isn't sent back.</li>
        </ul>
      ),
    },
  ],
};
