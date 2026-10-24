/** Languages by ISO 639-1 code with their own names, for book language and translation target. */
export const LANGUAGES: Record<string, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  ru: 'Русский',
  el: 'Ελληνικά',
  la: 'Latina',
};

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code;
}
