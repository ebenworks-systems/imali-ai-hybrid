// The checks every reading must pass before it goes into the book. They are plain code, so they run on the device,
// offline, in a few microseconds, and they never trust a model with arithmetic.

import { KINDS, type Reading } from '../book/types';
import { amountsIn, currencyIn, mentionsEach, numbersIn, same } from './numbers';

export interface CheckResult {
  ok: boolean;
  /** One plain sentence per problem, shown to the owner and sent (with the names found taken out) to the second opinion. */
  problems: string[];
  /** The checks that passed, shown as ticks. */
  passed: string[];
}

/** Words that say the customer pays later, in the languages the book reads. */
const CREDIT =
  /(?<![\p{L}\p{N}_])(on credit|owes?|will pay|pay later|pays? (?:on |next |by )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|later|month[- ]end)|à crédit|paiera|paie (?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain)|atalipa|atanilipa|kwa mkopo)(?![\p{L}\p{N}_])/iu;

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Checks that hold for every reading, from words or from a receipt photo. */
function shapeAndSums(r: Reading, problems: string[], passed: string[]) {
  if (!KINDS.includes(r.kind)) problems.push(`The kind "${String(r.kind)}" is not one the book keeps.`);
  if (!Array.isArray(r.items) || r.items.length === 0) {
    problems.push('The reading has no items.');
    return;
  }
  let linesOk = true;
  for (const l of r.items) {
    if (!(l.quantity > 0)) {
      problems.push(`"${l.name}" has a quantity of ${l.quantity}.`);
      linesOk = false;
    }
    if (!(l.unit_price >= 0) || !(l.line_total >= 0)) {
      problems.push(`"${l.name}" has a negative or missing price.`);
      linesOk = false;
      continue;
    }
    if (!same(l.quantity * l.unit_price, l.line_total)) {
      problems.push(
        `"${l.name}": ${money(l.quantity)} x ${money(l.unit_price)} is ${money(l.quantity * l.unit_price)}, not ${money(l.line_total)}.`,
      );
      linesOk = false;
    }
  }
  if (linesOk) passed.push('Each line: quantity x price = line total');
  const sum = r.items.reduce((s, l) => s + (l.line_total || 0), 0);
  if (!same(sum, r.total)) problems.push(`The lines add up to ${money(sum)}, but the total says ${money(r.total)}.`);
  else passed.push('The lines add up to the total');
  if (!/^[A-Z]{3}$/.test(r.currency ?? '')) problems.push(`"${String(r.currency)}" is not a currency code.`);
}

/** Checks a reading of the owner's own words against those words. */
export function checkWords(r: Reading, words: string, shopCurrency?: string): CheckResult {
  const problems: string[] = [];
  const passed: string[] = [];
  shapeAndSums(r, problems, passed);
  if (problems.some((p) => p === 'The reading has no items.')) return { ok: false, problems, passed };

  // Every amount the words mark as a price for one unit must be a unit price in the reading.
  const eachAmounts = amountsIn(words).filter((a) => a.each);
  let eachOk = true;
  for (const a of eachAmounts) {
    if (!r.items.some((l) => same(l.unit_price, a.value))) {
      const got = r.items.map((l) => money(l.unit_price)).join(', ');
      problems.push(`The words say ${money(a.value)} each, but the reading has a unit price of ${got}.`);
      eachOk = false;
    }
  }
  if (eachAmounts.length && eachOk) passed.push('Prices "each" match the words');

  // Every number in the reading must come from the words, or follow from them by multiplying or adding.
  const said = numbersIn(words);
  const fromWords = (v: number) =>
    said.some((n) => same(n, v)) || said.some((a) => said.some((b) => same(a * b, v)));
  let grounded = true;
  for (const l of r.items) {
    if (!fromWords(l.quantity) && !(l.quantity === 1 && !mentionsEach(words))) {
      problems.push(`The quantity ${money(l.quantity)} for "${l.name}" is not in the words.`);
      grounded = false;
    }
    const priceOk = fromWords(l.unit_price) || said.some((n) => same(n, l.line_total));
    if (!priceOk) {
      problems.push(`The price ${money(l.unit_price)} for "${l.name}" is not in the words.`);
      grounded = false;
    }
  }
  if (!fromWords(r.total) && !same(r.items.reduce((s, l) => s + l.line_total, 0), r.total)) {
    problems.push(`The total ${money(r.total)} is not in the words.`);
    grounded = false;
  }
  if (grounded) passed.push('Every number comes from the words');

  const named = currencyIn(words, shopCurrency);
  if (named && named !== r.currency) problems.push(`The words name ${named}, but the reading says ${r.currency}.`);
  else if (named) passed.push(`Currency ${named} matches the words`);

  const later = Boolean(r.due) || CREDIT.test(words);
  if (r.kind === 'sale' && later) problems.push('The words say the customer pays later, so this is a sale on credit, not a paid sale.');
  else if (r.kind === 'debt' && later) passed.push('On credit, as the words say');

  if (r.kind === 'debt' && !r.person) problems.push('A debt needs the name of the person who owes it.');
  if (r.kind === 'payment' && !r.person) problems.push('A payment needs the name of the person who paid.');

  return { ok: problems.length === 0, problems, passed };
}

/** Checks a reading of a receipt photo: here only the arithmetic can be checked. */
export function checkReceipt(r: Reading): CheckResult {
  const problems: string[] = [];
  const passed: string[] = [];
  shapeAndSums(r, problems, passed);
  if (r.kind !== 'purchase' && r.kind !== 'expense') {
    problems.push(`A supplier's receipt is a purchase or an expense, not a ${r.kind}.`);
  }
  return { ok: problems.length === 0, problems, passed };
}
