// Reads the numbers and money marks out of what a shop owner typed, without any model.

const WORDS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12, half: 0.5,
  // French, which Gemini Nano reads on the device
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, vingt: 20,
};

/** Words that make the amount next to them a price for one unit. */
const EACH = /(?<![\p{L}\p{N}_])(each|per|apiece|a piece|chacun|chacune|l['’]unit[ée]|la pièce|kila mmoja|kila moja)(?![\p{L}\p{N}_])/iu;

export interface Amount {
  value: number;
  /** True when the text says the amount is for one unit ("R15 each", "@ 15", "15 per loaf"). */
  each: boolean;
  /** Where the number starts in the text. */
  index: number;
}

// A comma or a space groups thousands ("1 200 shillings", "5 000F"), but a space does not when a measure follows the
// last group, in any case: "3 750ml", "3 750 ml" and "3 750mL" are 3 bottles of 750 ml. The "l" of "l'unité" is not a
// measure.
const NUMBER =
  /(?:@\s*)?(?:[A-Za-z₹$€£]{0,4}\s?)?(\d{1,3}(?:(?:,| (?=\d{3}(?!\s?(?:[mMcC]?[lL]|[mMkK]?[gG])(?![A-Za-zà-ÿ'’]))))\d{3})+|\d+)(?:[.,](\d{1,2}))?(\s?k\b)?/g;

function toNumber(whole: string, cents: string | undefined, k: string | undefined): number {
  const n = Number(whole.replace(/[ ,]/g, '')) + (cents ? Number(cents.padEnd(2, '0')) / 100 : 0);
  return k ? n * 1000 : n;
}

// A currency word that may sit between an amount and the word that makes it a price for one ("5000 FCFA chacun",
// "5000 F par sac", "5000 F CFA par sac", "5000 francs CFA par sac"). Codes are listed, not [A-Z]{3}, which the i flag
// would let match any three-letter word ("3 sac par sac").
const CURRENCY =
  '(?:francs?\\s+CFA|F\\.?\\s*CFA|dollars?|rands?|shillings?|rupees?|francs?|frs?|euros?|naira|cedis?|bob|FCFA|CFA|ZiG|' +
  '[KTU]?Sh|' +
  'USD|ZAR|KES|INR|XOF|XAF|ZWG|ZWL|NGN|GHS|EUR|GBP|TZS|UGX|RWF|MWK|ZMW|BWP|MZN|ETB|EGP|MAD|F(?![\\p{L}\\p{N}_]))';
const CURRENCY_WORD = `(?:${CURRENCY}\\s*)?`;

// French "par" is "for each" before a unit ("par sac", "par bouteille") but "by", "a" or "in" before anything else: a
// person ("par Awa", "par mon frère"), a way of paying ("par Orange Money", "par momo"), a time ("par jour") or an
// instalment ("par tranche"). Those have no end, so "par" counts only before a shop unit from this list, or before the
// word the owner used for the item ("3 bouteilles ... par bouteille"), in any case.
const PAR_UNITS =
  /^(?:sacs?|bouteilles?|kilos?|kg|grammes?|g|litres?|l|pi[eè]ces?|unit[ée]s?|paquets?|cartons?|bo[iî]tes?|sachets?|tas|bottes?|douzaines?|plats?|assiettes?|morceaux?|morceau|tasses?|verres?|m[eè]tres?|caisses?|bidons?|seaux?|seau|portions?|rouleaux?|rouleau|boules?|miches?|pains?|[oœ]e?ufs?|t[eê]tes?|personnes?|canettes?|cannettes?|flacons?|pots?|barres?|plaquettes?)$/iu;

// A money mark stuck before the digits ("R15", "$5", "KSh 300"); NUMBER also takes a short word there ("riz 15000").
const PRICE_MARK = new RegExp(`^(?:@\\s*)?(?:${CURRENCY}|R|Rs|KSh|Ksh|\\$|€|£|₹)$`, 'iu');

const NUMBER_WORDS = Object.keys(WORDS).join('|');
const ARTICLES = 'un|une|a|an';
/** Verbs that open a clause other than the sale's. */
const OTHER_VERBS =
  're[cç]u(?:e|s|es)?|livr[eé](?:e|s|es)?|ach[eéè]t[eé]?(?:e|s|es)?|pay[eé](?:e|s|es)?|command[eé](?:e|s|es)?|' +
  'pris(?:e|es)?|arriv[eé](?:e|s|es)?|received|got|delivered|bought|ordered|paid';
/** Words for the customer, after which a verb's participle describes them ("à un client payé cash"). */
const PERSON_WORDS = 'clients?|clientes?|customers?|amie?s?|voisine?s?|dame|dames|monsieur|madame|femme|homme|personne';
/** Words before which "commande" or "paye" is a noun, not a verb ("sur commande", "avec la paye"). */
const NOUN_LEADS = 'la|le|les|une|un|sur|en|de|du|par|ma|ta|sa|mon|ton|son|notre|votre|leur';
/** The number words that are never an article. */
const COUNT_WORDS = Object.keys(WORDS)
  .filter((w) => !ARTICLES.split('|').includes(w))
  .join('|');

/** The words the owner used for items: the word right after a count ("3 sacs", "trois bouteilles de lait"). */
function itemWords(text: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:\\d+|${NUMBER_WORDS})\\s+(?:de\\s+|d['’])?(\\p{L}+)`, 'giu');
  for (const m of text.matchAll(re)) {
    // A word after "par" is not an item ("par jour" in "3000 F par jour").
    if (/par\s+$/i.test(text.slice(0, m.index))) continue;
    out.add(m[1].toLowerCase().replace(/[sx]$/, ''));
  }
  return out;
}

/**
 * Whether "par <unit>" after an amount makes it a price for one. A bare count before "par" is a pack size, not a
 * price ("2 cartons, 12 par carton, 6000 F"), so the amount must be priced: a currency between it and "par", a
 * currency stuck to it, or "à" or "at" before it.
 */
function parForOne(after: string, before: string, prefix: string, rest: string): boolean {
  const m = new RegExp(`^\\s*(${CURRENCY}\\s*)?par\\s+(\\p{L}+)(?![\\p{L}\\p{N}_'’])`, 'iu').exec(after);
  if (!m) return false;
  const word = m[2].toLowerCase();
  const stem = word.replace(/[sx]$/, '');
  const isItem = stem.length >= 3 && itemWords(before).has(stem);
  // NUMBER takes a short word typed before the digits into its match ("at 5000"), so read it there too.
  // A bare "a" is not taken: in "il y a 12 par carton" it is the verb, and a pack size is not a price.
  const priced = PRICE_MARK.test(prefix) || /^at$/iu.test(prefix);
  if (!m[1] && !priced && !/(?:^|[^\p{L}])(?:à|at)\s*$/iu.test(before)) {
    // A bare "pour" or "for" prices the amount only in a sale whose count and item come right before it, when "par"
    // names that item, the text names no currency and no number follows: "Vendu 2 sacs pour 5000 par sac" is a price
    // for one; "Commande pour 12 par carton, 6000 F", "6000 F: 2 cartons pour 12 par carton", "... pour 12 par carton,
    // total 6000", "Reçu 2 cartons pour 12 par carton", "Vendu 2 sacs, livré pour 3 par sac" and "Livré pour 3 par
    // personne" are not. The count stands alone ("la" is not "a") and is the first number, in digits or a word, after the verb ("Vendu hier, 2
    // sacs pour 5000 par sac" is a price; in "Vendu 2 sacs, reçu 2 cartons pour 12 par carton" the 2 sacs are the sale's
    // count, so 12 is not).
    const lead = /^(?:pour|for)$/iu.test(prefix) ? `${before} ${prefix}` : before;
    // An article stops the span like any count ("Vendu un sac, reçu 2 cartons"), except after a word such as "à",
    // where it is "a" or "one" of someone, not the count ("Vendu à une cliente, 2 sacs"). Another verb starts another
    // clause, so it stops the span too ("Vendu à une cliente, reçu hier 2 cartons pour 12 par carton", "achète 2 cartons"),
    // except right after a word for the customer, where it describes them ("Vendu à un client payé cash, 2 sacs"), or
    // after an article or a preposition, where it is a noun ("Vendu sur commande 2 sacs", "avec la paye").
    const stop =
      `(?:${COUNT_WORDS})(?![\\p{L}])|(?<!(?:^|[^\\p{L}])(?:à|au|aux|pour|to|for|de|avec)\\s+)(?:${ARTICLES})(?![\\p{L}])|` +
      `(?<!(?:^|[^\\p{L}])(?:${PERSON_WORDS}|${NOUN_LEADS})\\s+)(?<!(?:^|[^\\p{L}])[dl]['’])(?:${OTHER_VERBS})(?![\\p{L}])`;
    const sale = new RegExp(
      `(?:^|[^\\p{L}])(?:vendu|vendus|vendue|vendues|vend|vends|sold|sell|sells)(?![\\p{L}])(?:(?!(?<![\\p{L}\\p{N}])(?:${stop}))[^.;\\d])*?(?<![\\p{L}\\p{N}])(?:\\d+(?:[ ,.]\\d{3})*|${NUMBER_WORDS})\\s+(?:de\\s+|d['’])?\\p{L}+\\s+(?:pour|for)\\s*$`,
      'iu',
    );
    const later = rest.slice(m[0].length);
    return sale.test(lead) && isItem && !hasCurrency(before) && !hasCurrency(later) && !/\d/.test(later);
  }
  return PAR_UNITS.test(word) || isItem;
}

/** True when the text names a currency anywhere ("6000 F", "R30", "KSh 300", "francs"). */
function hasCurrency(text: string): boolean {
  return (
    currencyIn(text) !== null ||
    new RegExp(`(?<!\\p{L})${CURRENCY}(?!\\p{L})`, 'iu').test(text) ||
    /[$€£₹₦₵]/u.test(text)
  );
}

/** Every number written in digits, with whether the text marks it as a price for one unit. */
export function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const index = m.index ?? 0;
    const value = toNumber(m[1], m[2], m[3]);
    const after = text.slice(index + m[0].length, index + m[0].length + 48);
    const before = text.slice(Math.max(0, index - 3), index);
    const each =
      m[0].trimStart().startsWith('@') ||
      new RegExp(`^\\s*${CURRENCY_WORD}(?:each|per|apiece|a piece|chacun|chacune|l['’]unit[ée]|la pièce|kila mmoja|kila moja)(?![\\p{L}\\p{N}_])`, 'iu').test(after) ||
      parForOne(
        after,
        text.slice(0, index),
        m[0].slice(0, m[0].search(/\d/)).replace(/^@\s*/, '').trim(),
        text.slice(index + m[0].length),
      ) ||
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

const SHILLING_SHOPS = ['KES', 'TZS', 'UGX'];
const SHILLINGS = 'shillings';

const MARKS: [RegExp, string][] = [
  // Case matters for TSh and USh, so "ush" or "tsh" in a sentence is not a currency.
  [/\bT[Ss]hs?\b|\bTZS\b/, 'TZS'],
  [/\bU[Ss]hs?\b|\bUGX\b/, 'UGX'],
  // A country's shillings before the plain word, as the model's currency name reads them (hybrid.ts CURRENCY_FORMS).
  [/\bTanzanian?\s+shillings?\b/i, 'TZS'],
  [/\bUgandan?\s+shillings?\b/i, 'UGX'],
  [/\bKshs?\b|\bKES\b|\bKenyan?\s+shillings?\b/i, 'KES'],
  [/\bshillings?\b/i, SHILLINGS],
  [/₹|\bRs\.?\s?\d|\bINR\b|\brupees?\b/i, 'INR'],
  [/\bF\s?CFA\b|\bCFA\b|\bXOF\b/i, 'XOF'],
  [/\bZAR\b|\brands?\b|(?:^|[\s(])R\s?\d/i, 'ZAR'],
  [/\bZWG\b|\bZiG\b/i, 'ZWG'],
  [/\bNGN\b|₦|\bnaira\b/i, 'NGN'],
  [/\bGHS\b|₵|\bcedis?\b/i, 'GHS'],
  [/\bUSD\b|US\$|\$\s?\d|\bdollars?\b/i, 'USD'],
  [/€|\bEUR\b|\beuros?\b/i, 'EUR'],
];

/**
 * The currency plain "shillings" means: the shop's own when the shop keeps Kenyan, Tanzanian or Ugandan shillings, so a
 * Dar es Salaam owner's "5000 shillings" is TZS, and Kenyan shillings in any other shop.
 */
export function plainShillings(shopCurrency?: string): string {
  return shopCurrency && SHILLING_SHOPS.includes(shopCurrency) ? shopCurrency : 'KES';
}

/** The currency the words name, if they name one. Plain "shillings" follows the shop (plainShillings). */
export function currencyIn(text: string, shopCurrency?: string): string | null {
  for (const [re, code] of MARKS) if (re.test(text)) return code === SHILLINGS ? plainShillings(shopCurrency) : code;
  return null;
}

/** Two money amounts are the same when they differ by less than a cent or by under half a percent. */
export function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
}
