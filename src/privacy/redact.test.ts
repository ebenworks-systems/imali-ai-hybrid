import { describe, expect, it } from 'vitest';
import { isClean, normalise, placeholderIn, placeholderLeft, redact, redactAlso, restore } from './redact';

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

describe('round 15 (EBE-11444)', () => {
  it('takes out an eight-digit phone and one written with no-break spaces', () => {
    for (const [said, phone] of [
      ['Pay Awa 70 12 34 56 tomorrow', '70 12 34 56'],
      ['Call 7123 4567 for the bread', '7123 4567'],
      ['Phone 077 123 4567 paid 30', '077 123 4567'],
      ['Phone 077 123 4567 paid 30', '077 123 4567'],
    ]) {
      const red = redact(said, []);
      expect(red.text).not.toContain(phone);
      // The phone is kept in its normalised form, no-break spaces as plain spaces (round 19).
      expect(Object.values(red.map)).toContain(normalise(phone));
      expect(isClean(said, red.map)).toBe(false);
      expect(isClean(red.text, red.map)).toBe(true);
    }
  });

  it('keeps an amount next to a phone, a list of prices and a date', () => {
    const a = redact('Sold 2 bread for R30 (0771234567)', []);
    expect(a.text).toBe('Sold 2 bread for R30 ([PHONE_1])');
    expect(a.map['[PHONE_1]']).toBe('0771234567');
    expect(redact('Thandi owes R30. 0771234567', []).text).toBe('[PERSON_1] owes R30. [PHONE_1]');
    expect(redact('Sold 3 loaves 12.50 25.00 37.50', []).text).toBe('Sold 3 loaves 12.50 25.00 37.50');
    expect(redact('Paid on 12.11.2026 and 12-11-2026', []).text).toBe('Paid on 12.11.2026 and 12-11-2026');
  });

  it("does not take an item the owner calls 'Phone 2' for a placeholder, whole or inside a value", () => {
    expect(placeholderLeft({ items: [{ name: 'Phone 2' }] }, {}, 'Sold Phone 2 for R50')).toBeNull();
    const red = redact('Sold Phone 2 to 0771234567 for R50', []);
    expect(placeholderLeft({ items: [{ name: 'Phone 2' }] }, red.map, 'Sold Phone 2 to 0771234567 for R50')).toBeNull();
  });
});

describe('round 16 (EBE-11626)', () => {
  it('takes out a phone written one space after a price, and keeps the price', () => {
    for (const [said, phone, kept] of [
      ['Airtime 5.00 0771234567', '0771234567', '5.00'],
      ['Sold bread 12.50 0771234567', '0771234567', '12.50'],
      ['Call 0771234567 12.50 owed', '0771234567', '12.50'],
    ]) {
      const red = redact(said, []);
      expect(red.text).not.toContain(phone);
      expect(red.text).toContain(kept);
      expect(Object.values(red.map)).toContain(phone);
      expect(isClean(said, red.map)).toBe(false);
      expect(isClean(red.text, red.map)).toBe(true);
    }
    expect(redact('Sold 3 loaves 12.50 25.00 37.50', []).text).toBe('Sold 3 loaves 12.50 25.00 37.50');
  });

  it('takes out a phone written with two spaces or spaced dashes, and a +263 (0) number whole', () => {
    for (const [said, phone] of [
      ['Call 077  123 4567 later', '077  123 4567'],
      ['Call 077 - 123 - 4567 later', '077 - 123 - 4567'],
      ['Call +263 (0)77 123 4567 later', '+263 (0)77 123 4567'],
    ]) {
      const red = redact(said, []);
      expect(red.text).toBe('Call [PHONE_1] later');
      expect(red.map['[PHONE_1]']).toBe(phone);
      expect(isClean(said, red.map)).toBe(false);
    }
    expect(redact('Thandi owes R30. 0771234567', []).text).toBe('[PERSON_1] owes R30. [PHONE_1]');
  });

  it('keeps an ISO date and a range of dates, and takes out an eight-digit amount rather than risk a phone', () => {
    for (const said of ['Paid on 2026-11-12', 'Away 12/11-15/11', 'Away 12/11/2026-15/11/2026']) {
      expect(redact(said, []).text).toBe(said);
    }
    // An amount of eight digits or more is taken out: the reading then cannot be checked, but no phone can pass for one.
    for (const said of ['Sold a cow for UGX 25 000 000', 'Sold a cow for 25000000 shillings', 'Sold a cow for 25 000 000']) {
      const red = redact(said, []);
      expect(red.text).toMatch(/\[PHONE_1\]/);
      expect(isClean(red.text, red.map)).toBe(true);
    }
    // An eight-digit phone goes however it is grouped.
    expect(redact('Call 71 234 567', []).map['[PHONE_1]']).toBe('71 234 567');
    expect(redact('Pay Awa 70 12 34 56 tomorrow', []).map['[PHONE_1]']).toBe('70 12 34 56');
    expect(redact('Call 70123456 for the bread', []).map['[PHONE_1]']).toBe('70123456');
  });

  it("takes the owner's phone out of a problem line and keeps the price beside it", () => {
    const red = redact('Airtime 5.00 0771234567', []);
    expect(redactAlso('The price 5.00 0771234567 is not in the words.', red)).toBe('The price 5.00 [PHONE_1] is not in the words.');
    expect(redactAlso('The quantity 771234567 is not in the words.', red)).toBe('The quantity [PHONE_1] is not in the words.');
  });

  it('takes out every phone typed beside an amount, a currency, another phone or a date-like shape (rounds 17 and 18)', () => {
    for (const [said, phone] of [
      ['Sent KSh 1000 0712345678', '0712345678'],
      ['$ 1200 0771234567', '0771234567'],
      ['Airtime $5 771234567', '771234567'],
      ['Ecocash $20 263771234567', '263771234567'],
      ['KSh 100 254712345678', '254712345678'],
      ['Sent 1000 0712345678 shillings', '0712345678'],
      ['M-Pesa 2500 0712345678 KES', '0712345678'],
      ['Sent to 254712345678 KES 500', '254712345678'],
      ['Airtime to 771234567 USD 5', '771234567'],
      ['Mpesa 254 712 345 678 KES 200', '254 712 345 678'],
      ['Call 263 77 123 4567 bob', '263 77 123 4567'],
      ['Ravi 9876543210 9123456780 paid Rs 200', '9876543210'],
      ['Ravi 9876543210 9123456780 paid Rs 200', '9123456780'],
      ['Tendai 0771234567 0772345678 owes $5', '0771234567'],
      ['credit Awa 5000F 70123456', '70123456'],
      ['vendu riz 5000 CFA 70123456', '70123456'],
      ['Paid R50 821234567', '821234567'],
      ['Rs 9876543210', '9876543210'],
      ['KES 712345678', '712345678'],
      ['Sold 2 bread 771234567 dollars', '771234567'],
      ['Awa doit 70123456 F.', '70123456'],
      ['USD 771 234 567', '771 234 567'],
      ['Moussa 7012-34-56 doit 2000F', '7012-34-56'],
      ['numero 12.34-56.78', '12.34-56.78'],
      ['07 07 12 34 56 doit 5000F', '07 07 12 34 56'],
    ]) {
      const red = redact(said, []);
      expect(red.text, said).not.toContain(phone);
      expect(Object.values(red.map).some((v) => v.includes(phone)), said).toBe(true);
      expect(isClean(said, red.map), said).toBe(false);
      expect(isClean(red.text, red.map), said).toBe(true);
    }
  });

  it('keeps a short amount typed one space before a phone that opens with 0', () => {
    const red = redact('Sold 2 bread 30 0771234567', []);
    expect(red.text).toBe('Sold 2 bread 30 [PHONE_1]');
    expect(red.map['[PHONE_1]']).toBe('0771234567');
    // A country code with no + stays with its number.
    expect(redact('Call 263 77 123 4567', []).map['[PHONE_1]']).toBe('263 77 123 4567');
  });

  it("does not turn an item the owner calls 'Phone 1' into the phone number on restore", () => {
    const said = 'Sold Phone 1 to 0771234567 for R50';
    const red = redact(said, []);
    expect(red.map['[PHONE_1]']).toBe('0771234567');
    const back = restore({ items: [{ name: 'Phone 1' }], person: '[PHONE_1]' }, red.map, said);
    expect(back.items[0].name).toBe('Phone 1');
    expect(back.person).toBe('0771234567');
    // Without the owner's words, a whole-field "Phone 1" is still the placeholder rewritten.
    expect(restore({ person: 'Phone 1' }, red.map).person).toBe('0771234567');
  });
});

describe('round 19 (EBE-11663)', () => {
  it("takes out a phone whose last pair is written like a price, so a peeled 'price' leaves no stub", () => {
    for (const [said, phone] of [
      ['Tél 06 12 34 56.78', '06 12 34 56.78'],
      ['Call 077 123 45.67', '077 123 45.67'],
    ]) {
      const red = redact(said, []);
      expect(red.map['[PHONE_1]'], said).toBe(phone);
      expect(isClean(said, {}), said).toBe(false);
      expect(isClean(red.text, red.map), said).toBe(true);
    }
    // A price beside a phone, and a list of prices, still stay.
    expect(redact('Airtime 5.00 0771234567', []).text).toBe('Airtime 5.00 [PHONE_1]');
    expect(redact('Sold 12.50 25.00 37.50', []).text).toBe('Sold 12.50 25.00 37.50');
  });

  it('takes out a phone written in other digits or with other separators', () => {
    for (const said of [
      'tel ٠٧٧١٢٣٤٥٦٧',
      'tel ۰۷۷۱۲۳۴۵۶۷',
      'Call 077 . 123 . 4567',
      'tel 077 / 123 / 4567',
      'tel 077−123−4567',
      'tel 077·123·4567',
      'tel 077​123​4567',
    ]) {
      const red = redact(said, []);
      expect(red.text, said).toBe(said.startsWith('Call') ? 'Call [PHONE_1]' : 'tel [PHONE_1]');
      expect(isClean(said, {}), said).toBe(false);
    }
    // A spaced date is still a date.
    expect(redact('Sold on 12 / 11 / 2026', []).text).toBe('Sold on 12 / 11 / 2026');
  });

  it('refuses a phone the redaction rule does not know, by a wider rule of its own', () => {
    for (const said of ['tel 077 , 123 , 4567', 'tel 077_123_4567', '+263 ; 77 ; 123 4567']) {
      expect(isClean(redact(said, []).text, redact(said, []).map), said).toBe(false);
    }
    for (const said of ['Sold 1500, 2000, 3000 bread', 'Open 08:30 09:45 10:15', 'Sold 2 at 0.50, 0.75, 0.25, 1.25']) {
      expect(isClean(said, {}), said).toBe(true);
    }
  });

  it('does not take a second amount for part of a first one taken out', () => {
    for (const said of ['Sold 10 bags UGX 100000 each, total UGX 10000000', 'Sold 1 cow 25000000 UGX, paid 5000000 now']) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(true);
    }
    const red = redact('Sold 1 cow 25000000 UGX', []);
    expect(redactAlso('The total 2500000 is not 25000000', red)).toBe('The total 2500000 is not [PHONE_1]');
    // The owner's phone written with its country code and no + still takes its part the device prints.
    const own = redact('Call 263771234567', []);
    expect(redactAlso('Quantity 771234567 is too large', own)).toBe('Quantity [PHONE_1] is too large');
  });

  it('keeps a date at either end of a run with a price or a count', () => {
    for (const said of ['Sold 3 bread 30 12/11/2026', 'Sold 3 bread 12/11/2026 30', 'Sold on 12/11/2026 3 bread', 'Sold 12/11/2026 14:30 2 bread']) {
      expect(redact(said, []).text, said).toBe(said);
    }
    expect(redact('Pay 12.11.2026 0771234567', []).text).toBe('Pay 12.11.2026 [PHONE_1]');
  });
});

describe('round 19, second pass (EBE-11663)', () => {
  it('takes out a phone written with direction marks between its groups', () => {
    for (const said of ['tel 77‎123‎4567', 'tel ٢٦٣‏٧٧‏١٢٣‏٤٥٦٧']) {
      expect(redact(said, []).text, said).toBe('tel [PHONE_1]');
    }
  });

  it("keeps a phone's last pair written like a price with the phone, whatever opens it", () => {
    for (const said of ['Call +263 77 123 45.67', 'Call 0033 6 12 34 56.78', 'Call +263 (0) 77 123 45.67']) {
      expect(redact(said, []).text, said).toBe('Call [PHONE_1]');
    }
    expect(redact('Airtime 0771234567 5.00', []).text).toBe('Airtime [PHONE_1] 5.00');
  });

  it('does not join two amounts across a full stop, a spaced slash or a bullet', () => {
    for (const said of ['Sold 5 sacks at 12500. 10000 paid.', 'Vendu 3 sacs à 15000. 45000 reçu.', 'Paid 5000 / 10000 for the cow']) {
      expect(redact(said, []).text, said).toBe(said);
    }
    expect(redact('Prices: 1500 • 2000 • 3000', []).map).toEqual({});
    expect(redact('12500 . 0771234567', []).map['[PHONE_1]']).toBe('0771234567');
  });

  it('lets comma prices and time ranges through the wider check', () => {
    for (const said of [
      'Prix 1,00 2,00 3,00 4,00',
      'Sold 4 at 2,50, 3,00, 1,00, 4,00',
      'Sold 5 at 0,50 0,75 1,25 2,50 5,00',
      'Shop open 08:30-17:00, sold 3 bread',
      'Sold 3 bread at 08:30:00-09:15:00',
    ]) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(true);
    }
  });

  it('refuses digits joined by an underscore, a semicolon or a bar', () => {
    for (const said of ['tel 263_77_123_4567', 'tel 77_123_4567', 'tel 263 ; 77 ; 123 4567', 'tel 263|77|123|4567']) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(false);
    }
  });
});

describe('round 19, third pass (EBE-11663)', () => {
  it('reads a phone joined by spaced dots, slashes or bullets whole when a piece is short', () => {
    for (const said of [
      'tel 263 . 77 . 123 . 4567',
      'tel 263 / 77 / 123 / 4567',
      'tel 263 • 77 • 123 • 4567',
      'tel 77 . 123 . 4567',
      'tel 1 / 800 / 555 / 1234',
      'tel 33 . 6 . 12 . 34 . 56 . 78',
      'tel 263 . 77 . 123 . 45.67',
    ]) {
      expect(redact(said, []).text, said).toBe('tel [PHONE_1]');
    }
    expect(redact('Paid 50 . 077 . 123 . 4567', []).text).toBe('Paid [PHONE_1]');
    expect(redact('Paid 5000 / 10000 for the cow', []).text).toBe('Paid 5000 / 10000 for the cow');
  });

  it('refuses a phone joined by colons or double dashes', () => {
    for (const said of ['tel 263 : 77 : 123 : 4567', 'tel 263--77--123--4567']) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(false);
    }
  });

  it('keeps a range or list of prices joined by a lone mark', () => {
    for (const said of [
      'Price range 12.50 - 25.00',
      'Sold 2 bread 100.00 - 250.00',
      'Sold at 1.50 - 2.00 - 2.50 - 3.00',
      'Prices 0.50 / 0.75 / 1.25 / 2.50',
    ]) {
      expect(redact(said, []).text, said).toBe(said);
    }
    expect(redact('Airtime 0771234567 - 5.00', []).text).toBe('Airtime [PHONE_1] - 5.00');
  });

  it('lets split time ranges and two-digit days through the wider check', () => {
    for (const said of ['Open 08:30-12:00/14:00-17:00', 'Sold 05, 10, 15, 20 bread', 'Sold on 12 / 11 / 2026']) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(true);
    }
  });

  it('takes out a phone in superscript or circled digits', () => {
    for (const said of ['tel ⁰⁷⁷¹²³⁴⁵⁶⁷', 'tel ①②③④⑤⑥⑦⑧⑨']) expect(redact(said, []).text, said).toBe('tel [PHONE_1]');
  });

  it("matches the device's eight-digit part of a phone written with its country code and no +", () => {
    const own = redact('Call 263771234567', []);
    expect(redactAlso('Quantity 77123456 is too large', own)).toBe('Quantity [PHONE_1] is too large');
  });
});

describe('second review round 20 (EBE-11672)', () => {
  it('refuses a phone written in comma-joined pairs that opens with 0', () => {
    for (const said of ['tel 06, 12, 34, 56, 78', 'tel 07 , 07 , 12 , 34 , 56']) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(false);
    }
    const days = redact('Sold 01, 02, 03, 04 bread', []);
    expect(isClean(days.text, days.map, days.parts)).toBe(true);
  });

  it('lets sums and ranges of amounts through the wider check', () => {
    for (const said of [
      'Sold 500 + 700 + 300 = 1500',
      'Total 1200 + 350 = 1550',
      'Change 1000 - 250 = 750 to 2 people',
      'Shared 12000 / 4 = 3000 each',
      'Sold 3 for 150: 450 + 300 = 750',
      '2*500=1000 total',
      'Prices 100-150, 200-250',
      'Sold kids shoes sizes 10-12, 13-15',
    ]) {
      const red = redact(said, []);
      expect(isClean(red.text, red.map, red.parts), said).toBe(true);
    }
    const phone = redact('tel 263 : 77 : 123 : 4567', []);
    expect(isClean(phone.text, phone.map, phone.parts)).toBe(false);
  });

  it('does not give a large amount taken out as a phone to a smaller amount inside it', () => {
    const red = redact('Paid 1500000000 for stock', []);
    expect(redactAlso('Total 500000 does not match 3 x 150000', red)).toBe('Total 500000 does not match 3 x 150000');
    const owe = redact('Paid 1500000000 for stock, owe 500000', []);
    expect(isClean(owe.text, owe.map, owe.parts)).toBe(true);
    const own = redact('Call 22670123456', []);
    expect(redactAlso('Quantity 70123456 is too large', own)).toBe('Quantity [PHONE_1] is too large');
  });

  it('matches a known name stored with a combining accent', () => {
    const name = 'aimé';
    const red = redact(`paid ${name} 50 today`, [name]);
    expect(red.text).toBe('paid [PERSON_1] 50 today');
    expect(isClean(`Customer ${name} owes 50`, red.map, red.parts, [name])).toBe(false);
    expect(redactAlso(`Customer ${name} owes 50`, red, [name])).toBe('Customer [PERSON_1] owes 50');
  });
});

describe('second review round 20, second pass (EBE-11672)', () => {
  const clean = (said: string) => {
    const red = redact(said, []);
    return isClean(red.text, red.map, red.parts);
  };

  it('refuses a phone joined by any odd mark, even in a run with a sum', () => {
    for (const said of [
      "tel 263'77'123'4567",
      'tel 263*77*123*4567',
      'tel 263 + 77 + 123 + 4567',
      'tel 263 ( 77 ) 123 4567',
      'tel 263 = 77 = 123 = 4567',
      'Total 500 + 700 = 1200, 263:77:123:4567 paid',
      'tel 263:77:123:4567 = 500',
      'tel 263--77--123--4567 = 5',
    ]) {
      expect(clean(said), said).toBe(false);
    }
  });

  it('lets a sum written with space thousands through', () => {
    expect(clean('Total 12 500 + 7 500 = 20 000')).toBe(true);
  });

  it('maps an eight-digit part of a ten-digit phone and any six-digit part of a country-code phone', () => {
    const ten = redact('Sold 2 bread to 9876543210', []);
    expect(redactAlso('Quantity 98765432 is too large', ten)).toBe('Quantity [PHONE_1] is too large');
    const full = redact('Call 263771234567', []);
    expect(redactAlso('Quantity 771234', full)).toBe('Quantity [PHONE_1]');
  });
});

describe('second review round 20, third pass (EBE-11672)', () => {
  const clean = (said: string) => {
    const red = redact(said, []);
    return isClean(red.text, red.map, red.parts);
  };

  it("refuses a phone whose local part looks like a range", () => {
    for (const said of ['Call 212)555-1234', 'Call [263] 771-2345', 'Call 263 # 771-2345', 'Call 263, 771-2345']) {
      expect(clean(said), said).toBe(false);
    }
    expect(clean('1500 + 2000 = 3500, 150-200')).toBe(true);
  });

  it('lets a sum written with comma thousands through', () => {
    for (const said of ['Total 1,500 + 2,000 = 3,500', 'Total 2 * 1,250 = 2,500']) expect(clean(said), said).toBe(true);
  });

  it('reads a long chain of sums without an answer quickly', () => {
    const start = Date.now();
    clean('1+'.repeat(20000) + '1');
    clean('1 000 + '.repeat(5000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
