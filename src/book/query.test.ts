import { describe, expect, it } from 'vitest';
import { answer, balances } from './query';
import type { Entry, Kind } from './types';

const now = new Date('2026-11-12T15:00:00');
let n = 0;
const e = (kind: Kind, total: number, person: string | null, daysAgo = 0, item = 'bread'): Entry => ({
  id: String(++n),
  createdAt: now.getTime() - daysAgo * 86_400_000,
  source: 'words',
  words: '',
  language: 'en',
  reading: { kind, items: [{ name: item, quantity: 1, unit_price: total, line_total: total }], total, currency: 'ZAR', person, due: null },
  status: 'checked',
  problems: [],
  hops: [],
});

const book = [
  e('debt', 45, 'Thandi'),
  e('payment', 30, 'thandi'),
  e('debt', 120, 'Sipho', 1, 'airtime'),
  e('sale', 60, null, 0, 'maize meal'),
  e('expense', 200, null, 0, 'electricity'),
  e('purchase', 500, 'Sunrise Valley Wholesale', 40, 'stock'),
];

describe('answer', () => {
  it('works out what one person owes, whatever the case of the name', () => {
    expect(answer({ intent: 'owed_by', person: 'THANDI', item: null, period: 'all' }, book, 'ZAR', now).text).toBe(
      'Thandi owes you R15.',
    );
    expect(balances(book).get('sipho')?.owed).toBe(120);
  });

  it('lists who owes, largest first', () => {
    const a = answer({ intent: 'who_owes', person: null, item: null, period: 'all' }, book, 'ZAR', now);
    expect(a.rows.map((r) => r.label)).toEqual(['Sipho', 'Thandi']);
    expect(a.text).toBe('2 people owe you R135 in all.');
  });

  it('adds up sales and spending by period', () => {
    expect(answer({ intent: 'sales_total', person: null, item: null, period: 'today' }, book, 'ZAR', now).figure).toBe(105);
    expect(answer({ intent: 'expenses_total', person: null, item: null, period: 'this_month' }, book, 'ZAR', now).figure).toBe(200);
    expect(answer({ intent: 'profit', person: null, item: null, period: 'today' }, book, 'ZAR', now).text).toBe(
      'You lost R95 today, sales less spending.',
    );
  });

  it('names the best-selling item', () => {
    const a = answer({ intent: 'top_items', person: null, item: null, period: 'all' }, book, 'ZAR', now);
    expect(a.rows[0].label).toBe('airtime');
  });

  it('keeps debts in each currency apart', () => {
    const kes = { ...e('debt', 120, 'Juma'), reading: { ...e('debt', 120, 'Juma').reading, currency: 'KES' } };
    const a = answer({ intent: 'who_owes', person: null, item: null, period: 'all' }, [...book, kes], 'ZAR', now);
    expect(a.text).toBe('3 people owe you R135 and KSh 120.');
    expect(a.figure).toBe(135);
    expect(a.rows.map((r) => `${r.label} ${r.currency}`)).toEqual(['Sipho ZAR', 'Thandi ZAR', 'Juma KES']);
    expect(answer({ intent: 'owed_by', person: 'juma', item: null, period: 'all' }, [...book, kes], 'ZAR', now).text).toBe('Juma owes you KSh 120.');
  });

  it('never adds an entry in another currency into a total', () => {
    const kes = { ...e('sale', 120, null), reading: { ...e('sale', 120, null).reading, currency: 'KES' } };
    expect(answer({ intent: 'sales_total', person: null, item: null, period: 'today' }, [...book, kes], 'ZAR', now).figure).toBe(105);
  });

  it('leaves out entries that still need the owner or wait for a check', () => {
    const needs = { ...e('debt', 999, 'Thandi'), status: 'needs-you' as const };
    const waiting = { ...e('debt', 500, 'Thandi'), status: 'waiting' as const };
    expect(balances([...book, needs, waiting]).get('thandi')?.owed).toBe(15);
  });
});
