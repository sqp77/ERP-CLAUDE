/** Arabic normalization for search (CLAUDE.md "Language and locale"): أ إ آ → ا, ة → ه, ى → ي, strip tashkeel. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

const CLASSES: Record<string, string> = { ا: '[اأإآ]', ه: '[هة]', ي: '[يى]' };
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tashkeel range written as literal characters: MongoDB's PCRE2 does not accept \uXXXX escapes. */
const TASHKEEL = '[\u064B-\u0652\u0670]*';

/** Regex that matches stored (un-normalized) text for a user query, tolerant of hamza, ta marbuta, alef maqsura and tashkeel. */
export function arabicSearchRegex(query: string): RegExp {
  const q = normalizeArabic(query);
  const body = [...q].map((c) => (c === ' ' ? '\\s+' : (CLASSES[c] ?? escape(c)) + TASHKEEL)).join('');
  return new RegExp(body, 'i');
}
