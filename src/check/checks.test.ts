import { describe, expect, it } from 'vitest';
import type { Reading } from '../book/types';
import { checkReceipt, checkWords } from './checks';
import { amountsIn, currencyIn, mentionsEach } from './numbers';

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
    expect(amountsIn('R1 500 each')[0]).toMatchObject({ value: 1500, each: true });
  });

  it('does not join a count to a size in a measure', () => {
    expect(amountsIn('Sold 3 750ml cooking oil at R45 each').map((x) => x.value)).toEqual([3, 750, 45]);
    expect(amountsIn('2 500ml bottles').map((x) => x.value)).toEqual([2, 500]);
    expect(amountsIn('3 750 ml of oil').map((x) => x.value)).toEqual([3, 750]);
    expect(amountsIn('Sold 3 750mL oil at R45 each').map((x) => x.value)).toEqual([3, 750, 45]);
    expect(amountsIn('4 250Kg bags').map((x) => x.value)).toEqual([4, 250]);
    expect(amountsIn("Vendu 2 sacs à 2 500 l'unité").map((x) => [x.value, x.each])).toEqual([
      [2, false],
      [2500, true],
    ]);
  });

  it('keeps a spaced thousand together when a currency is stuck to it', () => {
    expect(amountsIn('Paid 5 000F for rent')[0].value).toBe(5000);
    expect(amountsIn('Paid 1 500Ksh for transport')[0].value).toBe(1500);
    expect(amountsIn('Vendu 2 sacs à 2 500FCFA chacun').map((x) => [x.value, x.each])).toEqual([
      [2, false],
      [2500, true],
    ]);
  });

  it("reads the French \"l'unité\" as a price for one", () => {
    expect(mentionsEach("Vendu 2 sacs de riz à 5000 FCFA l'unité")).toBe(true);
    expect(amountsIn("Vendu 2 sacs de riz à 5000 FCFA l'unité").find((x) => x.value === 5000)?.each).toBe(true);
    expect(amountsIn('Vendu 2 sacs de riz à 5000 FCFA la pièce').find((x) => x.value === 5000)?.each).toBe(true);
    expect(amountsIn('Vendu 2 sacs de riz à 5000 FCFA par sac').find((x) => x.value === 5000)?.each).toBe(true);
    expect(amountsIn("Vendu 2 sacs de riz à 5000 FCFA l'unite").find((x) => x.value === 5000)?.each).toBe(true);
  });

  it('still allows a quantity of one when "par" means "by"', () => {
    const words = 'Awa a payé 2000 FCFA par Orange Money';
    const pay = r({ kind: 'payment', person: 'Awa', items: [{ name: 'payment', quantity: 1, unit_price: 2000, line_total: 2000 }], total: 2000, currency: 'XOF' });
    expect(checkWords(pay, words).ok).toBe(true);
  });

  it('reads "par" before a payment channel or a time word as "by", not as a price for one', () => {
    const words = 'Vendu 3 sacs de riz 15000 FCFA par Orange Money';
    const right = r({ items: [{ name: 'riz', quantity: 3, unit_price: 5000, line_total: 15000 }], total: 15000, currency: 'XOF' });
    expect(checkWords(right, words).ok).toBe(true);
    for (const tail of ['par mobile money', 'par carte', 'par wave', 'par jour', 'par mois', 'par Awa', 'par momo', 'par mon frère', 'par le client', 'par lui']) {
      expect(amountsIn(`Payé 15000 FCFA ${tail}`)[0].each).toBe(false);
    }
    expect(checkWords(right, 'Vendu 3 sacs de riz 15000 FCFA par mon frère').ok).toBe(true);
    expect(amountsIn('Vendu 2 sacs de riz à 5000 FCFA par sac').find((x) => x.value === 5000)?.each).toBe(true);
    expect(amountsIn('Vendu 3 bouteilles à 750 FCFA par bouteille').find((x) => x.value === 750)?.each).toBe(true);
  });

  it('does not take a word said earlier, an instalment or a pack size for a price for one', () => {
    const each = (s: string, v: number) => amountsIn(s).find((x) => x.value === v)?.each;
    expect(each('Chaque jour je vends 30 pains, 3000 F par jour', 3000)).toBe(false);
    expect(each('Vendu 3 sacs de riz: 10000 par Orange Money et 5000 par Orange Money', 5000)).toBe(false);
    expect(each('Reçu 5000 par Wave de Fatou puis 3000 par Wave', 3000)).toBe(false);
    expect(each('Vendu 3 plats à Aminata, 4500 par Aminata', 4500)).toBe(false);
    expect(each('Moussa doit 30000, il paie 10000 F par tranche', 10000)).toBe(false);
    expect(each('Vendu 3 sac par sac 5000', 3)).toBe(false);
    expect(each('Vendu 2 cartons, 12 par carton, 6000 F', 12)).toBe(false);
    // Round 13 (EBE-11444): a number word must stand alone ("la" is not "a"), and the count is the sale's own, not a
    // later clause's.
    expect(each('Vendu 2 sacs, la livraison pour 3 par sac', 3)).toBe(false);
    expect(each('Vendu 2 sacs, reçu 2 cartons pour 12 par carton', 12)).toBe(false);
    // Round 14 (EBE-11444): a comma before the count does not stop it, and the count may carry thousands.
    expect(each('Vendu hier, 2 sacs pour 5000 par sac', 5000)).toBe(true);
    expect(each('Vendu à Awa, 2 sacs pour 5000 par sac', 5000)).toBe(true);
    expect(each('Vendu 1,000 sacs pour 50 par sac', 50)).toBe(true);
    // Round 15: a count written as a word is the sale's count too, so a later clause's is not taken.
    expect(each('Vendu un sac, reçu 2 cartons pour 12 par carton', 12)).toBe(false);
    expect(each('Vendu deux sacs, reçu trois cartons pour 12 par carton', 12)).toBe(false);
    const pains = r({ items: [{ name: 'pain', quantity: 30, unit_price: 100, line_total: 3000 }], total: 3000, currency: 'XOF' });
    expect(checkWords(pains, 'Chaque jour je vends 30 pains, 3000 F par jour').ok).toBe(true);
  });

  it('reads a price for one after KSh, TSh, Sh and frs, and after "at" typed before the amount, never after the verb "a" or a bare "pour"', () => {
    const each = (s: string, v: number) => amountsIn(s).find((x) => x.value === v)?.each;
    expect(each('Sold 3 loaves 300 KSh each', 300)).toBe(true);
    expect(each('Niliuza mikate 3, 300 Ksh kila mmoja', 300)).toBe(true);
    expect(each('Sold 2 sodas 1500 TSh each', 1500)).toBe(true);
    expect(each('Sold 2 sodas 50 Sh each', 50)).toBe(true);
    expect(each('Vendu 2 sacs 5000 frs chacun', 5000)).toBe(true);
    expect(each('Vendu 2 sacs pour 5000 FCFA par sac', 5000)).toBe(true);
    // A bare "pour" prices the amount when "par" names the item counted before and no currency comes later.
    expect(each('Vendu 2 sacs pour 5000 par sac', 5000)).toBe(true);
    expect(each('Sold 2 bags for 5000 par bag', 5000)).toBe(true);
    expect(each('Vendu 2 cartons pour 12 par carton, 6000 F', 12)).toBe(false);
    expect(each('6000 F: 2 cartons pour 12 par carton', 12)).toBe(false);
    expect(each('Vendu 2 cartons pour 12 par carton, total 6000', 12)).toBe(false);
    expect(each('Reçu 2 cartons pour 12 par carton', 12)).toBe(false);
    expect(each('Vendu 2 sacs, livré pour 3 par sac', 3)).toBe(false);
    expect(each('Commande pour 12 par carton, 6000 F', 12)).toBe(false);
    expect(each('Livré pour 3 par personne', 3)).toBe(false);
    expect(each('Vendu 2 cartons, il y a  12 par carton, 6000 F', 12)).toBe(false);
    expect(each('Sold 2 bags at 5000 par bag', 5000)).toBe(true);
    expect(each('Vendu 2 cartons, 12 par carton, 6000 F', 12)).toBe(false);
    expect(each('Vendu 2 cartons, il y a 12 par carton, 6000 F', 12)).toBe(false);
    expect(each('Il y a 24 par caisse', 24)).toBe(false);
  });

  it('reads "par" before the item\'s own word in a plural in x, and never a time or a person after "des" or "quelques"', () => {
    const each = (s: string, v: number) => amountsIn(s).find((x) => x.value === v)?.each;
    expect(each('Vendu 4 gâteaux à 500 F par gâteau', 500)).toBe(true);
    expect(each('Depuis quelques jours je vends 30 pains, 3000 F par jour', 3000)).toBe(false);
    expect(each('Vendu des pains à des clients, 500 F par client', 500)).toBe(false);
    expect(each('Chaque jour je vends 30 pains, 3000 F par jour', 3000)).toBe(false);
  });

  it('reads "par" before a unit as a price for one in capitals, after F or francs CFA, and before the item\'s own word', () => {
    const at5000 = (s: string) => amountsIn(s).find((x) => x.value === 5000)?.each;
    expect(at5000('VENDU 2 SACS À 5000 FCFA PAR SAC')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000 F par sac')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000 francs CFA par sac')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000F chacun')).toBe(true);
    expect(at5000('Vendu 2 calebasses à 5000 FCFA par calebasse')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000 F CFA par sac')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000 F.CFA par sac')).toBe(true);
    expect(at5000('Vendu 2 sacs à 5000 par sac')).toBe(true);
    const words = 'VENDU 2 SACS À 5000 FCFA PAR SAC';
    const wrong = r({ items: [{ name: 'riz', quantity: 2, unit_price: 2500, line_total: 5000 }], total: 5000, currency: 'XOF' });
    expect(checkWords(wrong, words).ok).toBe(false);
  });

  it("catches a French price for one read as the line's total", () => {
    const words = "Vendu 2 sacs de riz à 5000 FCFA l'unité";
    const wrong = r({ items: [{ name: 'riz', quantity: 2, unit_price: 2500, line_total: 5000 }], total: 5000, currency: 'XOF' });
    expect(checkWords(wrong, words).ok).toBe(false);
    const right = r({ items: [{ name: 'riz', quantity: 2, unit_price: 5000, line_total: 10000 }], total: 10000, currency: 'XOF' });
    expect(checkWords(right, words).ok).toBe(true);
  });

  it('finds the currency the words name', () => {
    expect(currencyIn('Sold 3 loaves at R15 each')).toBe('ZAR');
    expect(currencyIn('Paid KSh 300 for transport')).toBe('KES');
    expect(currencyIn('Vendu 2 sacs de riz à 5000 FCFA')).toBe('XOF');
    expect(currencyIn('₹250 for tea')).toBe('INR');
    expect(currencyIn('12 dollars each')).toBe('USD');
    // Round 13 (EBE-11444): a country's shillings are its own, as the model's currency name reads them.
    expect(currencyIn('Sold 2 sodas for 1500 Tanzanian shillings')).toBe('TZS');
    expect(currencyIn('Paid 3000 Ugandan shillings for transport')).toBe('UGX');
    expect(currencyIn('Paid 300 Kenyan shillings')).toBe('KES');
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
    expect(checkWords(r({ kind: 'sale', person: 'Awa', due: null }), 'Vendu 3 pains à 15 R chacun à crédit à Awa').ok).toBe(false);
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

describe('plain shillings follow the shop (EBE-11626)', () => {
  it("reads plain shillings as the shop's own when the shop keeps shillings, and as KES elsewhere", () => {
    const words = 'Sold 2 sodas for 5000 shillings';
    expect(currencyIn(words, 'TZS')).toBe('TZS');
    expect(currencyIn(words, 'UGX')).toBe('UGX');
    expect(currencyIn(words, 'KES')).toBe('KES');
    expect(currencyIn(words, 'ZAR')).toBe('KES');
    expect(currencyIn(words)).toBe('KES');
    // A country named in the words still wins over the shop.
    expect(currencyIn('Paid 300 Kenyan shillings', 'TZS')).toBe('KES');
    expect(currencyIn('Paid 300 Kenya shillings', 'UGX')).toBe('KES');
    expect(currencyIn('Sold 2 sodas for 1500 Tanzanian shillings', 'UGX')).toBe('TZS');
  });

  it('fails a TZS shop\'s "5000 shillings" booked in KES and passes it in TZS', () => {
    const words = 'Sold 2 sodas for 5000 shillings';
    const sodas = { items: [{ name: 'soda', quantity: 2, unit_price: 2500, line_total: 5000 }], total: 5000 };
    expect(checkWords(r({ ...sodas, currency: 'KES' }), words, 'TZS').ok).toBe(false);
    expect(checkWords(r({ ...sodas, currency: 'TZS' }), words, 'TZS').ok).toBe(true);
    expect(checkWords(r({ ...sodas, currency: 'UGX' }), words, 'UGX').ok).toBe(true);
    expect(checkWords(r({ ...sodas, currency: 'KES' }), words, 'ZAR').ok).toBe(true);
  });
});

describe('round 16 sale span (EBE-11626)', () => {
  it('reads a French price for one after an article that is not the count', () => {
    for (const words of ['Vendu à une cliente, 2 sacs pour 5000 par sac', 'Vendu à un client 2 sacs pour 5000 par sac']) {
      expect(amountsIn(words).find((a) => a.value === 5000)?.each).toBe(true);
      const right = r({ items: [{ name: 'sac', quantity: 2, unit_price: 5000, line_total: 10000 }], total: 10000, currency: 'XOF' });
      expect(checkWords(right, words).ok).toBe(true);
      const wrong = r({ items: [{ name: 'sac', quantity: 2, unit_price: 2500, line_total: 5000 }], total: 5000, currency: 'XOF' });
      expect(checkWords(wrong, words).ok).toBe(false);
    }
    // An article that counts a unit is still the sale's count, so 12 is a pack size, not a price.
    for (const words of [
      'Vendu un sac, reçu 2 cartons pour 12 par carton',
      'Vendu un pagne, reçu 2 cartons pour 12 par carton',
      'Vendu une chèvre, reçu 2 sacs pour 5 par sac',
    ]) {
      expect(amountsIn(words).find((a) => a.value === 12 || a.value === 5)?.each).toBe(false);
    }
  });
});
