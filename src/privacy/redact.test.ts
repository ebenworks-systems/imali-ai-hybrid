import { describe, expect, it } from 'vitest';
import { isClean, redact, redactAlso, restore } from './redact';

describe('redact', () => {
  it('replaces a known customer and a name the book has not seen', () => {
    const out = redact('Sold 3 loaves at R15 each to Thandi Moyo, and Sipho took airtime for R20', ['Thandi Moyo']);
    expect(out.text).toBe('Sold 3 loaves at R15 each to [PERSON_1], and [PERSON_2] took airtime for R20');
    expect(out.map).toEqual({ '[PERSON_1]': 'Thandi Moyo', '[PERSON_2]': 'Sipho' });
    expect(isClean(out.text, out.map)).toBe(true);
  });

  it('replaces a name that opens the sentence when a person verb follows it', () => {
    const out = redact('Thandi paid R30 today');
    expect(out.text).toBe('[PERSON_1] paid R30 today');
  });

  it('keeps shop words, days and money marks', () => {
    const out = redact('Sold Bread on Friday for R15 and KSh 20');
    expect(out.text).toBe('Sold Bread on Friday for R15 and KSh 20');
  });

  it('replaces phone numbers', () => {
    const out = redact('Call Amina on +254 712 345 678 about the debt');
    expect(out.text).toBe('Call [PERSON_1] on [PHONE_1] about the debt');
  });

  it('replaces isiZulu and Kiswahili sentences the same way', () => {
    expect(redact('Ngithengise isinkwa ku-Thandi nge-R15').text).toBe('Ngithengise isinkwa ku-[PERSON_1] nge-R15');
    expect(redact('Nimeuza mkate kwa Juma kwa KSh 60').text).toBe('Nimeuza mkate kwa [PERSON_1] kwa KSh 60');
  });

  it('keeps Kiswahili day names and takes out the customer', () => {
    const r = redact('Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa');
    expect(r.text).toBe('Nimemuuzia [PERSON_1] mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa');
    expect(isClean(r.text, r.map)).toBe(true);
  });

  it('judges a name as a whole word, so a name inside a longer word does not stop the send', () => {
    const tom = redact('Sold 2 Cokes at R12 each to Tom, he pays tomorrow', ['Tom']);
    expect(tom.text).toBe('Sold 2 Cokes at R12 each to [PERSON_1], he pays tomorrow');
    expect(isClean(tom.text, tom.map)).toBe(true);
    expect(isClean('Sold 2 Cokes to Tom', tom.map)).toBe(false);
  });

  it('does not find a name inside a placeholder', () => {
    const r = redact('Sold 1 Phone charger to Thandi, call 0821234567', ['Thandi']);
    expect(r.text).toContain('[PHONE_1]');
    expect(isClean(r.text, r.map)).toBe(true);
  });

  it('takes out a known name with an underscore stuck to it', () => {
    const r = redact('Sold 2 Cokes to thandi_m and Thandi_2', ['Thandi']);
    expect(r.text).toBe('Sold 2 Cokes to [PERSON_1]_m and [PERSON_1]_2');
    expect(isClean(r.text, r.map)).toBe(true);
    expect(isClean('Sold 2 Cokes to thandi_m', r.map)).toBe(false);
  });

  it('takes out a known full name written as one handle', () => {
    for (const handle of ['thandi_moyo', 'thandi.moyo', 'thandi-moyo', 'Thandi  Moyo']) {
      const r = redact(`Sold 2 Cokes to ${handle}`, ['Thandi Moyo']);
      expect(r.text.toLowerCase()).not.toContain('moyo');
      expect(isClean(`Sold 2 Cokes to ${handle}`, r.map)).toBe(false);
    }
  });

  it('keeps two names apart across a full stop', () => {
    const r = redact('Paid Thandi. Moyo owes R30', ['Thandi Moyo']);
    expect(Object.values(r.map)).not.toContain('Thandi Moyo');
    expect(r.text).not.toMatch(/thandi|moyo/i);
  });

  it('takes out each part of a known full name the full-name pattern misses', () => {
    for (const text of ['Sold to thandi. moyo', 'Sold 2 Cokes to thandi__moyo', 'Paid Thandi. Moyo is late', 'Sold to thandi - moyo']) {
      const r = redact(text, ['Thandi Moyo']);
      expect(r.text).not.toMatch(/thandi|moyo/i);
      expect(isClean(r.text, r.map)).toBe(true);
    }
    // A short particle in a name is not taken out on its own.
    expect(redact('Vendu 2 sacs de riz', ['Awa de Souza']).text).toBe('Vendu 2 sacs de riz');
  });

  it('takes a part of a known name only next to another part, so an ordinary word stays', () => {
    expect(redact('Tendai never paid for 2 loaves', ['Never Moyo']).text).toContain('never paid');
    expect(redact('Credit given to Tendai', ['Given Banda']).text).toContain('given');
    expect(redact('Vendu 3 pain à 100 F', ['Jean Pain']).text).toBe('Vendu 3 pain à 100 F');
    const two = redact('Paid Thandi. Moyo owes R30', ['Thandi Moyo']);
    expect(two.text).toBe('Paid [PERSON_1]. [PERSON_2] owes R30');
    expect(redact('Sold to awa. sy', ['Awa Sy']).text).not.toMatch(/awa|sy\b/i);
    expect(redact('Sold to mary-anne. moyo', ['Anne Banda', 'Mary-Anne Moyo']).text).not.toMatch(/mary|anne|moyo/i);
  });

  it('takes out each part of a known full name from the device\'s own lines too', () => {
    const r = redact('Sold 2 Cokes', []);
    const out = redactAlso('Check thandi. moyo line', r, ['Thandi Moyo']);
    expect(out).not.toMatch(/thandi|moyo/i);
    expect(redactAlso('"Loaves": price never given', redact('Sold', []), ['Never Moyo'])).toBe('"Loaves": price never given');
  });

  it('takes a split full name before a shorter known name, in both passes', () => {
    for (const text of ['Paid Thandi. Moyo, R30', 'sold to thandi. moyo, R30']) {
      const r = redact(text, ['Thandi Moyo', 'Thandi']);
      expect(r.text).not.toMatch(/thandi|moyo/i);
      expect(isClean(r.text, r.map, r.parts, ['Thandi Moyo', 'Thandi'])).toBe(true);
    }
    const red = redact('Thandi paid R30', ['Thandi Moyo']);
    expect(redactAlso('Check thandi. moyo line', red, ['Thandi Moyo'])).not.toMatch(/thandi|moyo/i);
  });

  it('keeps a split part apart from the names, so the same word alone stays and the check still passes', () => {
    const r = redact('Paid Never. Moyo R30, never again', ['Never Moyo']);
    expect(r.text).toBe('Paid [PERSON_1]. [PERSON_2] R30, never again');
    expect(isClean(r.text, r.map, r.parts, ['Never Moyo'])).toBe(true);
    expect(redactAlso('price never given', r, ['Never Moyo'])).toBe('price never given');
    // A split name the passes missed still fails the check.
    expect(isClean('Sold to thandi. moyo', {}, [], ['Thandi Moyo'])).toBe(false);
  });

  it('takes a split full name across a longer gap or a digit', () => {
    for (const text of ['Sold to thandi . . moyo', 'Sold to thandi2moyo']) {
      expect(redact(text, ['Thandi Moyo']).text).not.toMatch(/thandi|moyo/i);
    }
  });

  it('ignores a blank known name', () => {
    const r = redact('Sold 2 Cokes to Thandi', [' ', '']);
    expect(r.text).not.toContain('[PERSON_1]2');
    expect(r.text).toContain('Sold 2 Cokes');
  });

  it('takes the longest known name out of the problem lines first', () => {
    const red = redact('Sold 3 loaves to Thandi', ['Thandi', 'Thandi Moyo']);
    const line = redactAlso('"loaves for Thandi Moyo" has a quantity of 0.', red, ['Thandi', 'Thandi Moyo']);
    expect(line).toBe('"loaves for [PERSON_2]" has a quantity of 0.');
    expect(isClean(line, red.map)).toBe(true);
    expect(red.map['[PERSON_2]']).toBe('Thandi Moyo');
  });

  it('takes out a name with a digit stuck to it', () => {
    const r = redact('Sold 2 Cokes to Thandi2', ['Thandi']);
    expect(r.text).toBe('Sold 2 Cokes to [PERSON_1]2');
    expect(isClean('Sold 2 Cokes to Thandi2', r.map)).toBe(false);
  });

  it('takes out a French name that opens the sentence', () => {
    expect(redact('Awa a payé 2000 FCFA').text).toBe('[PERSON_1] a payé 2000 FCFA');
  });

  it('finds a name that ends in an accented letter', () => {
    const r = redact('Vendu 2 sacs de riz à Aimé, il paie samedi', ['Aimé']);
    expect(r.text).toBe('Vendu 2 sacs de riz à [PERSON_1], il paie samedi');
    expect(isClean('Vendu 2 sacs de riz à Aimé, il paie samedi', r.map)).toBe(false);
  });

  it('puts the names back in a nested answer', () => {
    const map = { '[PERSON_1]': 'Thandi' };
    expect(restore({ person: '[PERSON_1]', items: [{ name: 'bread for [PERSON_1]' }] }, map)).toEqual({
      person: 'Thandi',
      items: [{ name: 'bread for Thandi' }],
    });
  });
});
