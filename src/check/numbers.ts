// Reads the numbers and money marks out of what a shop owner typed, without any model.

const WORDS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12, half: 0.5,
  // French, which Gemini Nano reads on the device
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, vingt: 20,
};

/** Words that make the amount next to them a price for one unit. */
const EACH = /(?<![\p{L}\p{N}_])(each|per|apiece|a piece|chacun|chacune|l['’]unité|la pièce|kila mmoja|kila moja)(?![\p{L}\p{N}_])/iu;

export interface Amount {
  value: number;
  /** True when the text says the amount is for one unit ("R15 each", "@ 15", "15 per loaf"). */
  each: boolean;
  /** Where the number starts in the text. */
  index: number;
}

// A comma or a space groups thousands ("1 200 shillings", "5 000F"), but a space does not when a measure follows the
// last group: "3 750ml" and "3 750 ml" are 3 bottles of 750 ml.
const NUMBER =
  /(?:@\s*)?(?:[A-Za-z₹$€£]{0,4}\s?)?(\d{1,3}(?:(?:,| (?=\d{3}(?!\s?(?:ml|cl|l|kg|g|mg)(?![A-Za-zà-ÿ]))))\d{3})+|\d+)(?:[.,](\d{1,2}))?(\s?k\b)?/g;

function toNumber(whole: string, cents: string | undefined, k: string | undefined): number {
  const n = Number(whole.replace(/[ ,]/g, '')) + (cents ? Number(cents.padEnd(2, '0')) / 100 : 0);
  return k ? n * 1000 : n;
}

/** Every number written in digits, with whether the text marks it as a price for one unit. */
export function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const index = m.index ?? 0;
    const value = toNumber(m[1], m[2], m[3]);
    const after = text.slice(index + m[0].length, index + m[0].length + 24);
    const before = text.slice(Math.max(0, index - 3), index);
    const each =
      m[0].trimStart().startsWith('@') ||
      /^\s*(?:(?:dollars?|rands?|shillings?|rupees?|francs?|euros?|naira|cedis?|bob|[A-Z]{3}|CFA|FCFA|USD|ZiG)\s*)?(?:each|per|apiece|a piece|chacun|chacune|l['’]unité|la pièce|kila mmoja|kila moja)(?![\p{L}\p{N}_])/iu.test(after) ||
      /@\s*$/.test(before);
    out.push({ value, each, index });
  }
  return out;
}

/** Numbers written as words ("three loaves", "a dozen eggs"). Only the plain ones a shop uses. */
export function wordNumbersIn(text: string): number[] {
  const out: number[] = [];
  for (const w of text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) ?? []) {
    if (w in WORDS && w !== 'a' && w !== 'an' && w !== 'un' && w !== 'une') out.push(WORDS[w]);
  }
  return out;
}

/** All the numbers a reading may take from this text. */
export function numbersIn(text: string): number[] {
  return [...amountsIn(text).map((a) => a.value), ...wordNumbersIn(text)];
}

/** True when the text says some amount is a price for one unit. */
export function mentionsEach(text: string): boolean {
  return EACH.test(text) || /@\s*\d/.test(text);
}

const MARKS: [RegExp, string][] = [
  [/\bKSh\b|\bKsh\b|\bKES\b|\bshillings?\b/i, 'KES'],
  [/₹|\bRs\.?\s?\d|\bINR\b|\brupees?\b/i, 'INR'],
  [/\bF\s?CFA\b|\bCFA\b|\bXOF\b/i, 'XOF'],
  [/\bZAR\b|\brands?\b|(?:^|[\s(])R\s?\d/i, 'ZAR'],
  [/\bZWG\b|\bZiG\b/i, 'ZWG'],
  [/\bNGN\b|₦|\bnaira\b/i, 'NGN'],
  [/\bGHS\b|₵|\bcedis?\b/i, 'GHS'],
  [/\bUSD\b|US\$|\$\s?\d|\bdollars?\b/i, 'USD'],
  [/€|\bEUR\b|\beuros?\b/i, 'EUR'],
];

/** The currency the words name, if they name one. */
export function currencyIn(text: string): string | null {
  for (const [re, code] of MARKS) if (re.test(text)) return code;
  return null;
}

/** Two money amounts are the same when they differ by less than a cent or by under half a percent. */
export function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
}
