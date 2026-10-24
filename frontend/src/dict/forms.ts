/**
 * Dictionary forms to try for an inflected word, most likely first: "Häuser" → häuser, haus…;
 * "hablando" → hablar; "pensées" → pensée, penser. Not a real lemmatizer, a short list of common endings
 * per language; the dictionary decides which candidates exist.
 */

type Rule = [suffix: string, replacements: string[]];

const RULES: Record<string, Rule[]> = {
  de: [
    ['ungen', ['ung']], ['innen', ['in']], ['nissen', ['nis']], ['nisse', ['nis']],
    ['test', ['en']], ['tet', ['en']], ['ten', ['en', 't']], ['te', ['en']], ['est', ['en']], ['st', ['en']],
    ['ern', ['er', '']], ['em', ['', 'e']], ['en', ['', 'e', 'en']], ['er', ['', 'e']], ['es', ['', 'e']],
    ['et', ['en']], ['t', ['en']], ['e', ['', 'en']], ['n', ['']], ['s', ['']],
  ],
  es: [
    ['ándose', ['ar']], ['iéndose', ['er', 'ir']], ['ando', ['ar']], ['iendo', ['er', 'ir']], ['yendo', ['er', 'ir']],
    ['ados', ['ar']], ['adas', ['ar']], ['ado', ['ar']], ['ada', ['ar']], ['idos', ['er', 'ir']], ['idas', ['er', 'ir']],
    ['ido', ['er', 'ir']], ['ida', ['er', 'ir']], ['aron', ['ar']], ['ieron', ['er', 'ir']], ['amos', ['ar']],
    ['emos', ['er']], ['imos', ['ir']], ['aba', ['ar']], ['aban', ['ar']], ['ía', ['er', 'ir']], ['ían', ['er', 'ir']],
    ['ces', ['z']], ['es', ['', 'e']], ['as', ['ar', 'o', 'a']], ['an', ['ar']], ['en', ['er', 'ir']],
    ['ó', ['ar']], ['é', ['ar']], ['o', ['ar', 'er', 'ir']], ['a', ['ar', 'o']], ['s', ['']],
  ],
  pt: [
    ['ões', ['ão']], ['ães', ['ão']], ['ais', ['al']], ['éis', ['el']], ['ando', ['ar']], ['endo', ['er']],
    ['indo', ['ir']], ['ados', ['ar']], ['adas', ['ar']], ['ado', ['ar']], ['ada', ['ar']], ['idos', ['er', 'ir']],
    ['ido', ['er', 'ir']], ['ida', ['er', 'ir']], ['aram', ['ar']], ['eram', ['er']], ['iram', ['ir']],
    ['amos', ['ar']], ['emos', ['er']], ['imos', ['ir']], ['ava', ['ar']], ['avam', ['ar']], ['ia', ['er', 'ir']],
    ['ou', ['ar']], ['eu', ['er']], ['iu', ['ir']], ['as', ['a', 'ar']], ['os', ['o']], ['am', ['ar']],
    ['em', ['er', 'ir']], ['a', ['ar', 'o']], ['o', ['ar', 'er', 'ir']], ['s', ['']],
  ],
  fr: [
    ['èrent', ['er']], ['aient', ['er', 're', 'ir']], ['ions', ['er', 're', 'ir']], ['iez', ['er', 're', 'ir']],
    ['ées', ['er', 'ée']], ['ée', ['er', 'ée']], ['és', ['er', 'é']], ['é', ['er']], ['ent', ['er', 're', 'ir']],
    ['ons', ['er', 're', 'ir']], ['ez', ['er']], ['ais', ['er']], ['ait', ['er']], ['aux', ['al', 'ail']],
    ['euses', ['eur']], ['euse', ['eur']], ['ives', ['if']], ['ive', ['if']], ['es', ['e', '']], ['e', ['', 'er']],
    ['s', ['']], ['x', ['']],
  ],
  en: [
    ['ies', ['y']], ['ied', ['y']], ['ying', ['ie']], ['ing', ['', 'e']], ['ed', ['', 'e']], ['es', ['', 'e']],
    ['est', ['', 'e']], ['er', ['', 'e']], ['ly', ['']], ["'s", ['']], ['s', ['']],
  ],
};

const UMLAUT: Record<string, string> = { ä: 'a', ö: 'o', ü: 'u', äu: 'au' };

export function candidateForms(key: string, language: string): string[] {
  const out = [key];
  const add = (w: string) => { if (w.length >= 2 && !out.includes(w)) out.push(w); };
  for (const [suffix, replacements] of RULES[language] ?? []) {
    if (key.length > suffix.length + 1 && key.endsWith(suffix)) {
      const stem = key.slice(0, -suffix.length);
      replacements.forEach((r) => add(stem + r));
    }
  }
  if (language === 'de') {
    // participles: ge…t / ge…en → …en ("gemacht" → machen, "gegangen" → gangen/gehen is beyond rules)
    const m = /^(.*?)ge(.+?)(t|en)$/.exec(key);
    if (m && m[2].length > 2) add(`${m[1]}${m[2]}en`);
    // plurals with umlaut: Häuser → Haus, Bäume → Baum
    for (const w of [...out]) {
      const unumlauted = w.replace(/äu|ä|ö|ü/g, (u) => UMLAUT[u]);
      if (unumlauted !== w) add(unumlauted);
    }
  }
  return out;
}
