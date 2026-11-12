import { describe, expect, it } from 'vitest';
import { isClean, redact, restore } from './redact';

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
  });

  it('puts the names back in a nested answer', () => {
    const map = { '[PERSON_1]': 'Thandi' };
    expect(restore({ person: '[PERSON_1]', items: [{ name: 'bread for [PERSON_1]' }] }, map)).toEqual({
      person: 'Thandi',
      items: [{ name: 'bread for Thandi' }],
    });
  });
});
