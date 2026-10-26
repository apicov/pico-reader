import { existsSync } from 'node:fs';
import { isValidElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MANUAL_CHAPTERS } from '@/components/manual/chapters';
import { ManualLink, Screenshot } from '@/components/manual/parts';
import ManualPage from './ManualPage';

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.search}</div>;
}

function renderManual(route = '/manual') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes><Route path="/manual" element={<><ManualPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

/** Every element of a type inside the manual's content (props included, e.g. Controls rows) */
function find(type: unknown, node: unknown = MANUAL_CHAPTERS.map((c) => c.sections.map((s) => s.body)), out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => find(type, n, out));
  else if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (node.type === type) out.push(props);
    Object.values(props).forEach((v) => find(type, v as ReactNode, out));
  } else if (node && typeof node === 'object') Object.values(node).forEach((v) => find(type, v, out));
  return out;
}

describe('the user manual', { timeout: 30_000 }, () => {
  it('shows every chapter', () => {
    renderManual();
    expect(screen.getByText('User manual', { selector: 'h1' })).toBeInTheDocument();
    for (const chapter of MANUAL_CHAPTERS) expect(screen.getByText(chapter.title, { selector: 'h2' })).toBeInTheDocument();
  });

  it('every link points at a chapter or section that exists, and ids are unique', () => {
    const targets = new Set(MANUAL_CHAPTERS.flatMap((c) => [c.id, ...c.sections.map((s) => `${c.id}.${s.id}`)]));
    expect(targets.size).toBe(MANUAL_CHAPTERS.length + MANUAL_CHAPTERS.reduce((n, c) => n + c.sections.length, 0));
    const links = find(ManualLink).map((p) => p.to as string);
    expect(links.length).toBeGreaterThan(20);
    expect(links.filter((to) => !targets.has(to))).toEqual([]);
  });

  it('has every picture it shows, under a unique name', () => {
    const names = find(Screenshot).map((p) => p.name as string);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => !existsSync(`public/manual/${n}.webp`))).toEqual([]);
  });

  it('the search keeps only the sections that mention every word', () => {
    renderManual();
    fireEvent.change(screen.getByLabelText('Search the manual'), { target: { value: 'journal running' } });
    expect(screen.getByText('The running file', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.queryByText('Signing in', { selector: 'h3' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search the manual'), { target: { value: 'xylophone' } });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing in the manual mentions “xylophone”.');
  });

  it('the contents go to a section with a ?s= link', () => {
    renderManual();
    fireEvent.click(screen.getByText('Contents', { selector: 'button' }));
    fireEvent.click(screen.getAllByText('Projects', { selector: 'button' })[0]);
    expect(screen.getByTestId('where')).toHaveTextContent('?s=computer.projects');
  });
});
