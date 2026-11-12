// Answers questions about the book with plain code. A model only turns the owner's question into a Query; the
// figures always come from here, from the records on this device.

import type { Entry, Period, Query } from './types';

export interface Answer {
  text: string;
  figure: number | null;
  /** Each row is in the shop's currency unless it names its own. */
  rows: { label: string; value: number; currency?: string }[];
}

function startOf(period: Period, now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case 'today':
      return d.getTime();
    case 'yesterday':
      return d.getTime() - 86_400_000;
    case 'this_week': {
      const day = (d.getDay() + 6) % 7; // Monday is the first day
      return d.getTime() - day * 86_400_000;
    }
    case 'this_month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    default:
      return 0;
  }
}

function endOf(period: Period, now: Date): number {
  if (period !== 'yesterday') return Number.POSITIVE_INFINITY;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const PERIOD_WORDS: Record<Period, string> = {
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
  this_month: 'this month',
  all: 'in the book so far',
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Only readings that passed the checks count towards balances and totals. */
export const counts = (e: Entry) => e.status === 'checked' || e.status === 'checked-in-cloud';

/** What each person owes now: credit sales minus what they paid. */
export function balances(entries: Entry[]): Map<string, { name: string; owed: number }> {
  const out = new Map<string, { name: string; owed: number }>();
  for (const e of entries) {
    if (!counts(e)) continue;
    const who = e.reading.person;
    if (!who) continue;
    const key = norm(who);
    const row = out.get(key) ?? { name: who, owed: 0 };
    if (e.reading.kind === 'debt') row.owed += e.reading.total;
    if (e.reading.kind === 'payment') row.owed -= e.reading.total;
    out.set(key, row);
  }
  return out;
}

/** What each person owes now in each currency, so a debt in shillings never mixes with one in rand. */
function owing(entries: Entry[]): { name: string; currency: string; owed: number }[] {
  const out = new Map<string, { name: string; currency: string; owed: number }>();
  for (const e of entries) {
    if (!counts(e) || !e.reading.person) continue;
    const key = `${norm(e.reading.person)}|${e.reading.currency}`;
    const row = out.get(key) ?? { name: e.reading.person, currency: e.reading.currency, owed: 0 };
    if (e.reading.kind === 'debt') row.owed += e.reading.total;
    if (e.reading.kind === 'payment') row.owed -= e.reading.total;
    out.set(key, row);
  }
  return [...out.values()];
}

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function fmt(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  const n = Math.abs(amount);
  const body = Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mark: Record<string, string> = { ZAR: 'R', USD: 'US$', KES: 'KSh ', INR: '₹', XOF: 'CFA ', EUR: '€', NGN: '₦', GHS: 'GH₵', ZWG: 'ZiG ' };
  return `${sign}${mark[currency] ?? currency + ' '}${body}`;
}

/**
 * Answer a question from the book. Only entries in the shop's currency are added up; an entry in another currency
 * stays in the book but never mixes into a total.
 */
export function answer(q: Query, book: Entry[], currency: string, now = new Date()): Answer {
  const all = book.filter((e) => e.reading.currency === currency);
  const from = startOf(q.period, now);
  const to = endOf(q.period, now);
  const inPeriod = all.filter((e) => e.createdAt >= from && e.createdAt < to && counts(e));
  const when = PERIOD_WORDS[q.period];
  const sum = (kinds: string[]) =>
    inPeriod.filter((e) => kinds.includes(e.reading.kind)).reduce((s, e) => s + e.reading.total, 0);

  switch (q.intent) {
    case 'owed_by': {
      const theirs = owing(book).filter((r) => q.person && norm(r.name) === norm(q.person));
      if (!theirs.length) return { text: `I have no debts for ${q.person ?? 'that person'} in the book.`, figure: 0, rows: [] };
      const open = theirs.filter((r) => r.owed > 0);
      if (!open.length) return { text: `${theirs[0].name} owes you nothing now.`, figure: 0, rows: [] };
      const figure = open.find((r) => r.currency === currency)?.owed ?? 0;
      return { text: `${theirs[0].name} owes you ${joinAnd(open.map((r) => fmt(r.owed, r.currency)))}.`, figure, rows: [] };
    }
    case 'who_owes': {
      const open = owing(book)
        .filter((r) => r.owed > 0)
        .sort((a, b) => Number(a.currency !== currency) - Number(b.currency !== currency) || b.owed - a.owed);
      if (!open.length) return { text: 'Nobody owes you money now.', figure: 0, rows: [] };
      const rows = open.map((r) => ({ label: r.name, value: r.owed, currency: r.currency }));
      const byCurrency = new Map<string, number>();
      for (const r of open) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.owed);
      const figure = byCurrency.get(currency) ?? 0;
      const people = new Set(open.map((r) => norm(r.name))).size;
      const who = people === 1 ? '1 person owes' : `${people} people owe`;
      if (byCurrency.size === 1 && byCurrency.has(currency)) return { text: `${who} you ${fmt(figure, currency)} in all.`, figure, rows };
      return { text: `${who} you ${joinAnd([...byCurrency].map(([c, v]) => fmt(v, c)))}.`, figure, rows };
    }
    case 'sales_total': {
      const total = sum(['sale', 'debt']);
      return { text: `You sold ${fmt(total, currency)} ${when}.`, figure: total, rows: [] };
    }
    case 'expenses_total': {
      const total = sum(['expense', 'purchase']);
      return { text: `You spent ${fmt(total, currency)} ${when}.`, figure: total, rows: [] };
    }
    case 'profit': {
      const total = sum(['sale', 'debt']) - sum(['expense', 'purchase']);
      const word = total >= 0 ? 'made' : 'lost';
      return { text: `You ${word} ${fmt(Math.abs(total), currency)} ${when}, sales less spending.`, figure: total, rows: [] };
    }
    case 'top_items':
    case 'item_sales': {
      const byItem = new Map<string, { label: string; value: number }>();
      for (const e of inPeriod.filter((x) => x.reading.kind === 'sale' || x.reading.kind === 'debt')) {
        for (const l of e.reading.items) {
          const k = norm(l.name);
          const row = byItem.get(k) ?? { label: l.name, value: 0 };
          row.value += l.line_total;
          byItem.set(k, row);
        }
      }
      if (q.intent === 'item_sales') {
        const want = norm(q.item);
        const rows = [...byItem.entries()].filter(([k]) => want && (k.includes(want) || want.includes(k))).map(([, r]) => r);
        const total = rows.reduce((s, r) => s + r.value, 0);
        return { text: `You sold ${fmt(total, currency)} of ${q.item ?? 'that'} ${when}.`, figure: total, rows };
      }
      const rows = [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 5);
      if (!rows.length) return { text: `No sales ${when} yet.`, figure: null, rows };
      return { text: `${rows[0].label} sold the most ${when}: ${fmt(rows[0].value, currency)}.`, figure: rows[0].value, rows };
    }
  }
}
