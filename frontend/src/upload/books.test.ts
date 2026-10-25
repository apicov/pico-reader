import { groupBooks, guessLanguage, markerCover, nameToMeta, type Picked } from './books';

const file = (path: string, size = 10) => ({ file: new File(['x'.repeat(size)], path.split('/').pop()!), path });
const KNUTH = 'Art of Computer Programming, The Combinatorial Algorithms, Volume 4B (Donald Knuth) (Z-Library)';

describe('chosen files → books', () => {
  it('makes a book of each marker folder below the chosen one, with its images', () => {
    const picked: Picked[] = [
      file(`books/${KNUTH}/${KNUTH}.md`), file(`books/${KNUTH}/${KNUTH}_meta.json`),
      file(`books/${KNUTH}/_page_1_Picture_0.jpeg`), file(`books/${KNUTH}/_page_0_Picture_0.jpeg`, 30_000),
      file(`books/${KNUTH}/${KNUTH}.epub`), // an export of the same book
      file('books/Tau Zero (Poul Anderson) (Z-Library)/Tau Zero (Poul Anderson) (Z-Library).md'),
      file('books/Tau Zero (Poul Anderson) (Z-Library)/_page_1_Picture_0.jpeg'),
      file('books/Die Wolke.epub'), file('books/Paper.pdf'),
    ];
    const books = groupBooks(picked);
    expect(books.map((b) => `${b.kind} ${b.file.name}`)).toEqual([ // by path; the EPUB beside the .md isn't one
      `markdown ${KNUTH}.md`, 'epub Die Wolke.epub', 'pdf Paper.pdf', 'markdown Tau Zero (Poul Anderson) (Z-Library).md']);
    const knuth = books.find((b) => b.file.name === `${KNUTH}.md`)!;
    expect([...knuth.images.keys()].sort()).toEqual(['_page_0_Picture_0.jpeg', '_page_1_Picture_0.jpeg']);
    expect(markerCover(knuth.images)?.name).toBe('_page_0_Picture_0.jpeg');
    const tau = books.find((b) => b.file.name.startsWith('Tau'))!;
    expect(tau.images.get('_page_1_Picture_0.jpeg')).not.toBe(knuth.images.get('_page_1_Picture_0.jpeg')); // its own
  });

  it("leaves out what's inside a book's folder: other .md files, node_modules, hidden folders", () => {
    const d = 'Deep Learning Interviews (Shlomo Kashani) (Z-Library)';
    const books = groupBooks([file(`${d}/${d}.md`), file(`${d}/machine_learning_cheatsheet/README.md`),
      file(`${d}/web/node_modules/x/README.md`), file('notes/.git/README.md'), file('notes/todo.md')]);
    expect(books.map((b) => b.key)).toEqual([`${d}/${d}.md`, 'notes/todo.md']);
  });

  it('a .md chosen with its images (no folder) takes them by name', () => {
    const [book] = groupBooks([file('thesis.md'), file('fig1.png'), file('fig2.png')]);
    expect([...book.images.keys()]).toEqual(['fig1.png', 'fig2.png']);
  });

  it('several PDFs and EPUBs chosen at once are several books', () => {
    expect(groupBooks([file('a.pdf'), file('b.epub'), file('c.PDF')]).map((b) => b.kind)).toEqual(['pdf', 'epub', 'pdf']);
  });
});

describe('title and author from the file name', () => {
  it.each([
    [KNUTH, 'The Art of Computer Programming: Combinatorial Algorithms, Volume 4B', 'Donald Knuth'],
    ['Art of Computer Programming, The Volume 3 Sorting and Searching (Knuth, Donald) (Z-Library).md',
      'The Art of Computer Programming: Volume 3 Sorting and Searching', 'Donald Knuth'],
    ['Der Computer - Mein Lebenswerk (Konrad Zuse (auth.)) (Z-Library)', 'Der Computer - Mein Lebenswerk', 'Konrad Zuse'],
    ['RAG with Python Cookbook (Early Release) (Dominik Polzer) (Z-Library)', 'RAG with Python Cookbook (Early Release)', 'Dominik Polzer'],
    ['German Grammar For Foreigners (Unknown) (Z-Library)', 'German Grammar For Foreigners', ''],
    ['Los números primos un largo camino al infinito by Enrique Gracián (z-lib.org)', 'Los números primos un largo camino al infinito', 'Enrique Gracián'],
    ['Mentes, máquinas y matemáticas - Ignasi Belda', 'Mentes, máquinas y matemáticas', 'Ignasi Belda'],
    ['complete_ml_cheatsheet.md', 'complete ml cheatsheet', ''],
  ])('%s', (name, title, author) => {
    expect(nameToMeta(name)).toEqual({ title, author });
  });
});

describe('language from the text', () => {
  it.each([
    ['de', 'Der Alarm kam am Vormittag, und die Lehrerin las die Durchsage vor. Es ist nicht so, dass sie mit dem Bus fuhr.'],
    ['en', 'The algorithm is a sequence of steps that is used to solve the problem, and it is the heart of this book.'],
    ['es', 'El número primo es un número que solo se divide por sí mismo y por la unidad, y los griegos ya lo sabían.'],
    ['pt', 'O português é uma língua que não é difícil para quem fala espanhol, e a gramática do português é clara.'],
  ])('%s', (lang, sentence) => {
    expect(guessLanguage(`${sentence} `.repeat(10))).toBe(lang);
  });

  it("is unsure about too little text or code", () => {
    expect(guessLanguage('x = 1')).toBe('');
    expect(guessLanguage('def f(x):\n    return x * 2\n'.repeat(50))).toBe('');
  });
});
