import { describe, expect, it } from 'vitest';
import type { Reading } from '../book/types';
import { checkReceipt, checkWords } from './checks';
import { amountsIn, currencyIn } from './numbers';

const r = (over: Partial<Reading>): Reading => ({
  kind: 'sale',
  items: [{ name: 'bread', quantity: 3, unit_price: 15, line_total: 45 }],
  total: 45,
  currency: 'ZAR',
  person: null,
  due: null,
  ...over,
});

describe('numbers', () => {
  it('marks a price for one unit', () => {
    const a = amountsIn('Sold 2 bags of maize meal for 12 dollars each');
    expect(a.map((x) => [x.value, x.each])).toEqual([
      [2, false],
      [12, true],
    ]);
    expect(amountsIn('3 loaves @ R15').find((x) => x.value === 15)?.each).toBe(true);
    expect(amountsIn('R15 each').find((x) => x.value === 15)?.each).toBe(true);
    expect(amountsIn('1 200 shillings')[0].value).toBe(1200);
    expect(amountsIn('R12.50')[0].value).toBe(12.5);
  });

  it('finds the currency the words name', () => {
    expect(currencyIn('Sold 3 loaves at R15 each')).toBe('ZAR');
    expect(currencyIn('Paid KSh 300 for transport')).toBe('KES');
    expect(currencyIn('Vendu 2 sacs de riz à 5000 FCFA')).toBe('XOF');
    expect(currencyIn('₹250 for tea')).toBe('INR');
    expect(currencyIn('12 dollars each')).toBe('USD');
    expect(currencyIn('Sold three loaves')).toBeNull();
  });
});

describe('checkWords', () => {
  it('passes a correct credit sale', () => {
    const words = 'Sold 3 loaves at R15 each to Thandi, she pays Friday';
    const out = checkWords(r({ kind: 'debt', person: 'Thandi', due: 'Friday' }), words);
    expect(out.problems).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it('catches a sale on credit read as paid, as Gemini Nano did on 12 Nov 2026', () => {
    const words = 'Sold 3 loaves at R15 each to Thandi, she pays Friday';
    const out = checkWords(r({ kind: 'sale', person: 'Thandi', due: 'Friday' }), words);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toMatch(/on credit/);
    expect(checkWords(r({ kind: 'sale', person: 'Thandi', due: null }), words).ok).toBe(false);
    expect(checkWords(r({ kind: 'sale' }), 'Sold 3 loaves at R15 each').ok).toBe(true);
    expect(checkWords(r({ kind: 'sale', person: 'Awa', due: null }), 'Vendu 3 pains à 15 R chacun à Awa, elle paie samedi').ok).toBe(false);
  });

  it('catches the unit-price mistake Gemini Nano made on 12 Nov 2026', () => {
    // Nano read "12 dollars each" as a total of 12 (unit price 6). The sums agree, the words do not.
    const words = 'Sold two bags of maize meal for 12 dollars each.';
    const nano = r({ items: [{ name: 'maize meal', quantity: 2, unit_price: 6, line_total: 12 }], total: 12, currency: 'USD' });
    const out = checkWords(nano, words);
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toMatch(/12 each/);
    const right = r({ items: [{ name: 'maize meal', quantity: 2, unit_price: 12, line_total: 24 }], total: 24, currency: 'USD' });
    expect(checkWords(right, words).ok).toBe(true);
  });

  it('catches bad arithmetic', () => {
    const out = checkWords(r({ items: [{ name: 'bread', quantity: 3, unit_price: 15, line_total: 40 }], total: 40 }), 'Sold 3 bread at R15 each');
    expect(out.ok).toBe(false);
    expect(out.problems[0]).toMatch(/3 x 15 is 45, not 40/);
  });

  it('catches a number that is not in the words', () => {
    const out = checkWords(r({ items: [{ name: 'sugar', quantity: 1, unit_price: 35, line_total: 35 }], total: 35 }), 'Sold sugar for R30');
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toMatch(/35/);
  });

  it('catches the wrong currency and a debt with no name', () => {
    const out = checkWords(r({ kind: 'debt', currency: 'USD' }), 'Sold 3 loaves at R15 each on credit');
    expect(out.problems).toContain('The words name ZAR, but the reading says USD.');
    expect(out.problems).toContain('A debt needs the name of the person who owes it.');
  });

  it('allows a quantity of one that the words leave out', () => {
    const out = checkWords(
      r({ kind: 'expense', items: [{ name: 'electricity', quantity: 1, unit_price: 200, line_total: 200 }], total: 200 }),
      'Paid the electricity token R200 this morning',
    );
    expect(out.ok).toBe(true);
  });

  it('accepts a total the lines add up to', () => {
    const words = 'Sold 2 Cokes at R12 each and 1 bread at R16';
    const reading = r({
      items: [
        { name: 'Coke', quantity: 2, unit_price: 12, line_total: 24 },
        { name: 'bread', quantity: 1, unit_price: 16, line_total: 16 },
      ],
      total: 40,
    });
    expect(checkWords(reading, words).ok).toBe(true);
  });

  it('refuses an empty reading', () => {
    expect(checkWords(r({ items: [] }), 'hello').ok).toBe(false);
  });
});

describe('checkReceipt', () => {
  it('passes when the lines add up', () => {
    const reading = r({
      kind: 'purchase',
      items: [
        { name: 'Cooking oil 2L', quantity: 2, unit_price: 64.99, line_total: 129.98 },
        { name: 'White sugar 2kg', quantity: 3, unit_price: 42.5, line_total: 127.5 },
      ],
      total: 257.48,
    });
    expect(checkReceipt(reading).ok).toBe(true);
  });

  it('fails when the total does not match the lines', () => {
    const reading = r({ kind: 'purchase', total: 50 });
    expect(checkReceipt(reading).problems).toContain('The lines add up to 45, but the total says 50.');
  });
});
