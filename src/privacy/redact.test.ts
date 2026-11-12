import { describe, expect, it } from 'vitest';
import { isClean, placeholderIn, placeholderLeft, redact, redactAlso, restore } from './redact';

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

  it('puts a name back when the model dropped or changed the brackets, and never into a longer number', () => {
    const map = { '[PERSON_1]': 'Juma', '[PERSON_10]': 'Awa' };
    expect(restore('PERSON_1', map)).toBe('Juma');
    expect(restore('{PERSON_1} pays Ijumaa', map)).toBe('Juma pays Ijumaa');
    expect(restore('<person_1>', map)).toBe('Juma');
    expect(restore('PERSON_10 and PERSON_1', map)).toBe('Awa and Juma');
    expect(restore('XPERSON_1', map)).toBe('XPERSON_1');
    expect(restore('PERSON1 and Person 1 and PERSON-1', map)).toBe('Juma and Juma and Juma');
  });

  it('finds a placeholder left in an answer in any form, and nothing in plain words', () => {
    expect(placeholderIn({ person: '[PERSON_3]' })).toBe('PERSON_3');
    expect(placeholderIn({ items: [{ name: 'bread for PERSON_1s' }] })).toBe('PERSON_1');
    expect(placeholderIn(['ok', { due: 'Person 2' }])).toBe('Person 2');
    expect(placeholderIn({ person: 'Juma', items: [{ name: 'personal 1 kg soap' }] })).toBeNull();
    expect(placeholderIn({ items: [{ name: 'phone 2 cases' }] })).toBeNull();
    expect(placeholderIn({ items: [{ name: 'airtime for PHONE 2' }] })).toBe('PHONE 2');
  });

  it('leaves "phone 1" in plain words alone and takes a phone placeholder back only in capitals or with its underscore', () => {
    const map = { '[PHONE_1]': '0772123456' };
    expect(restore('phone 1 charger', map)).toBe('phone 1 charger');
    expect(restore('PHONE_1 and PHONE 1 and phone_1', map)).toBe('0772123456 and 0772123456 and 0772123456');
    // A field that is nothing but the placeholder is one in any case.
    expect(restore({ person: 'Phone 1', due: '[phone-1]', item: 'Phone1' }, map)).toEqual({
      person: '0772123456',
      due: '0772123456',
      item: '0772123456',
    });
    expect(placeholderIn({ person: 'Phone 2' })).toBe('Phone 2');
    expect(placeholderIn({ person: '[phone-2]' })).toBe('phone-2');
    expect(placeholderIn({ items: [{ name: 'phone 2 charger' }] })).toBeNull();
  });

  it('looks for a leftover placeholder before the real values go back, so a number after "phone" is not one', () => {
    const map = { '[PHONE_1]': '0772123456', '[PERSON_1]': 'Juma' };
    const answer = { person: '[PERSON_1]', items: [{ name: 'airtime for phone [PHONE_1]' }] };
    expect(placeholderLeft(answer, map)).toBeNull();
    expect(placeholderLeft({ person: '[PERSON_3]' }, map)).toBe('PERSON_3');
    expect(placeholderLeft({ person: 'PERSON_1s' }, map)).toBe('PERSON_1');
  });

  it('puts the names back in a nested answer', () => {
    const map = { '[PERSON_1]': 'Thandi' };
    expect(restore({ person: '[PERSON_1]', items: [{ name: 'bread for [PERSON_1]' }] }, map)).toEqual({
      person: 'Thandi',
      items: [{ name: 'bread for Thandi' }],
    });
  });
});

describe('round 13 (EBE-11444)', () => {
  it("takes a phone number out of the device's problem lines, with the owner's own placeholder when the digits match", () => {
    const red = redact('Sold airtime 20 to 0771234567 for R10', []);
    expect(red.map['[PHONE_1]']).toBe('0771234567');
    // The device read the number as a quantity and printed it without the leading 0.
    const line = redactAlso('"airtime": 771234567 x 20, not 20.', red, []);
    expect(line).not.toContain('771234567');
    expect(line).toContain('[PHONE_1]');
    // A number written as a phone that the owner never wrote gets a placeholder of its own.
    const other = redactAlso('The person +263 77 212 3456 is not in the words.', red, []);
    expect(other).not.toMatch(/\d{3}/);
    expect(other).toContain('[PHONE_2]');
    expect(isClean('"airtime": 771234567 x 20', red.map)).toBe(false);
    expect(isClean(line, red.map)).toBe(true);
  });

  it('does not count an answer as clean while a phone placeholder sits inside a value in any case', () => {
    const red = redact('Sold airtime 20 to 0771234567 for R10', []);
    expect(placeholderLeft({ items: [{ name: 'airtime for Phone 1' }] }, red.map)).not.toBeNull();
    // With no phone in the map, "phone 1 charger" is an ordinary item.
    expect(placeholderLeft({ items: [{ name: 'phone 1 charger' }] }, {})).toBeNull();
  });
});

describe('round 14 (EBE-11444)', () => {
  it('takes out a phone written with brackets or dots, and the check refuses one left in', () => {
    for (const said of ['call (077) 123-4567 for R10', 'call 077.123.4567 for R10']) {
      const red = redact(said, []);
      expect(red.text).not.toMatch(/\d{3}/);
      expect(isClean(said, red.map)).toBe(false);
      expect(isClean(red.text, red.map)).toBe(true);
    }
    // A date keeps its digits: it has fewer than nine.
    expect(redact('Paid on 12/11/2026', []).text).toBe('Paid on 12/11/2026');
  });

  it("leaves an ordinary amount in a problem line and takes out part of the owner's phone", () => {
    const red = redact('Sold airtime 20 to 077 123 4567 for R10', []);
    expect(redactAlso('The total 1500000000 is not in the words.', red, [])).toBe('The total 1500000000 is not in the words.');
    expect(Object.keys(red.map).filter((k) => k.startsWith('[PHONE_'))).toHaveLength(1);
    const split = redactAlso('"airtime": 77123456 x 2, not 20.', red, []);
    expect(split).not.toContain('77123456');
    expect(isClean('"airtime": 77123456 x 2', red.map)).toBe(false);
    expect(isClean(split, red.map)).toBe(true);
  });

  it("does not take the owner's own 'phone 2' for a placeholder left over", () => {
    const said = 'Sold a phone 2 cover to 0771234567 for R50';
    const red = redact(said, []);
    expect(placeholderLeft({ items: [{ name: 'phone 2 cover' }] }, red.map, said)).toBeNull();
    expect(placeholderLeft({ items: [{ name: 'airtime for Phone 1' }] }, red.map, said)).not.toBeNull();
  });
});
