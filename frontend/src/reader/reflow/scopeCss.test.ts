import { scopeCss } from './scopeCss';

const squash = (css: string) => css.replace(/\s+/g, ' ').trim();

describe('scopeCss', () => {
  it('puts every selector under the scope, without adding specificity', () => {
    expect(squash(scopeCss('.callout, pre code span.kw { color: red; }', '.reflow')))
      .toBe(':where(.reflow) .callout, :where(.reflow) pre code span.kw { color: red; }');
  });

  it('makes the page roots the scope itself', () => {
    expect(squash(scopeCss('body { color: red; } html body p { margin: 0px; } :root { --x: 1; }', '.reflow')))
      .toBe(':where(.reflow) { color: red; } :where(.reflow) p { margin: 0px; } :where(.reflow) { --x: 1; }');
  });

  it('keeps commas inside :is() and attribute values, and scopes inside @media', () => {
    expect(squash(scopeCss('@media (max-width: 600px) { :is(h1, h2) > a[title="a,b"] { color: red; } }', '.reflow')))
      .toBe('@media (max-width: 600px) { :where(.reflow) :is(h1, h2) > a[title="a,b"] { color: red; } }');
  });
});
