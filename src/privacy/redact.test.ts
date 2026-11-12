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
