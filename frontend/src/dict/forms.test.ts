import { candidateForms } from './forms';
import { cleanWord, fold, keyOf } from './normalize';

describe('normalize', () => {
  it('keeps ß and composes decomposed umlauts', () => {
    expect(keyOf('Maße')).toBe('maße');
    expect(keyOf('Grün')).toBe('grün'); // u + combining diaeresis, as some PDFs encode it
    expect(fold('grün')).toBe('grun');
    expect(fold('maße')).toBe('maße');
  });

  it('strips punctuation and soft hyphens from a selection', () => {
    expect(cleanWord('»Straße,«')).toBe('Straße');
    expect(cleanWord('Ent­wicklung.')).toBe('Entwicklung');
    expect(cleanWord("l'homme")).toBe("l'homme");
  });
});

describe('candidateForms', () => {
  it('German plurals, umlauts and participles', () => {
    expect(candidateForms('häuser', 'de')).toContain('haus');
    expect(candidateForms('bäume', 'de')).toContain('baum');
    expect(candidateForms('gemacht', 'de')).toContain('machen');
    expect(candidateForms('kinder', 'de')).toContain('kind');
  });

  it('Spanish and Portuguese verbs', () => {
    expect(candidateForms('hablando', 'es')).toContain('hablar');
    expect(candidateForms('comieron', 'es')).toContain('comer');
    expect(candidateForms('canções', 'pt')).toContain('canção');
    expect(candidateForms('falou', 'pt')).toContain('falar');
  });

  it('French and English', () => {
    expect(candidateForms('pensées', 'fr')).toContain('penser');
    expect(candidateForms('studies', 'en')).toContain('study');
    expect(candidateForms('making', 'en')).toContain('make');
  });

  it('the word itself comes first', () => {
    expect(candidateForms('straße', 'de')[0]).toBe('straße');
  });
});
