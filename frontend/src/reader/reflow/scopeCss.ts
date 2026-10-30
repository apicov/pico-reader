/** A book's own CSS confined to its text: every selector under `:where(<scope>)` (no added specificity, so the
 *  book's rules and the app's reflow.css weigh against each other as before), `html`, `body` and `:root` becoming
 *  the scope itself. The rest of the app (and the other pages, with the book open behind them) stays untouched. */

/** The selectors of a list, split at its top-level commas (not those inside :is(), :not(), [attr="a,b"]) */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(list.slice(start, i).trim()); start = i + 1; }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

function scopeSelector(selector: string, scope: string): string {
  // the page's own roots (html, :root, body, in any combination) are the scope's element
  const m = /^((?:html|:root|body)(?![\w-])\s*)+/i.exec(selector);
  if (!m) return `${scope} ${selector}`;
  const rest = selector.slice(m[0].length);
  if (!rest) return scope;
  // `body p`, `body > p`: inside the scope; `body.dark p`: the scope with that class
  return /\s$/.test(m[0]) || /^[>+~]/.test(rest) ? `${scope} ${rest}` : `${scope}${rest}`;
}

function scopeRules(rules: CSSRuleList, scope: string): string {
  return Array.from(rules).map((rule) => {
    if ('selectorText' in rule && 'style' in rule) {
      const r = rule as CSSStyleRule;
      return `${splitSelectors(r.selectorText).map((s) => scopeSelector(s, scope)).join(', ')} { ${r.style.cssText} }`;
    }
    if ('conditionText' in rule && 'cssRules' in rule) {  // @media, @supports, @container
      const r = rule as CSSConditionRule;
      const at = r.cssText.slice(0, r.cssText.indexOf(r.conditionText)).trim();
      return `${at} ${r.conditionText} { ${scopeRules(r.cssRules, scope)} }`;
    }
    return rule.cssText;  // @font-face, @keyframes, …
  }).join('\n');
}

export function scopeCss(css: string, scope: string): string {
  // parsed by the browser in a sheet that applies to nothing (media "not all"), then taken out again
  const style = document.createElement('style');
  style.media = 'not all';
  style.textContent = css;
  document.head.append(style);
  try {
    return style.sheet ? scopeRules(style.sheet.cssRules, `:where(${scope})`) : '';
  } finally {
    style.remove();
  }
}
