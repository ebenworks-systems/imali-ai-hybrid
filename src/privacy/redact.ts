// Before any words leave the device for a second opinion, people's names and phone numbers are swapped for
// placeholders. The placeholders come back in the cloud's answer and are swapped back here, on the device.

export interface Redacted {
  text: string;
  /** placeholder -> original, kept on the device only */
  map: Record<string, string>;
  /**
   * The placeholders that hold one part of a known full name found written split ("Never" of "Never Moyo" in
   * "Never. Moyo"). The same word standing alone is an ordinary word, so the later passes and the check skip them.
   */
  parts?: string[];
}

/**
 * Digits with at most one separator between them: a run of spaces of any kind but a new line, a dash with or without
 * spaces round it ("077 - 123 - 4567"), or a bare dot or slash. It may open with "+", "(area code)" or "+263 (0)".
 * `phoneIn` decides which part of such a run is a phone number.
 */
const PHONE = /(?:\+\d{1,4}[^\S\n]*\(0\)[^\S\n]*|\+?\(\d{1,4}\)[^\S\n]*|\+)?\d(?:(?:[^\S\n]+|[^\S\n]*\p{Pd}[^\S\n]*|[./])?\d){5,}/gu;
const digitCount = (s: string) => s.replace(/\D/g, '').length;

/** A date ("12/11/2026", "2026-11-12") or two joined by a dash ("12/11-15/11"). */
const DAY = String.raw`(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}-\d{1,2}-\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})`;
const DATE = new RegExp(String.raw`^${DAY}(?:[^\S\n]*\p{Pd}[^\S\n]*${DAY})?$`, 'u');

/** A price with cents ("12.50", "5,00"), which never starts or ends a phone written with spaces. */
const PRICE = /^\d+[.,]\d{2}$/;

/** Thousands grouped by a space or a dot ("25 000 000", "12.500.000"). */
const THOUSANDS = /^[1-9]\d{0,2}(?:(?:[^\S\n]|\.)\d{3})+$/u;

/** A money mark right before an amount ("UGX 25 000 000", "R 12 500 000") or a currency word right after it. */
const CODES = 'USD|ZAR|KES|INR|XOF|XAF|ZWG|ZWL|NGN|GHS|EUR|GBP|TZS|UGX|RWF|MWK|ZMW|BWP|MZN|ETB|EGP|MAD';
const MONEY_BEFORE = new RegExp(String.raw`(?:(?<![\p{L}])(?:${CODES}|K?Shs?|TShs?|UShs?|Rs\.?|R|F|FCFA|CFA)|[$€£₹₦₵])[^\S\n]*$`, 'u');
// A currency after the run, not one that opens the next amount ("Sent to 254712345678 KES 500").
const MONEY_AFTER = [
  /^[^\S\n]*(?:shillings?|francs?|frs?|FCFA|CFA|rands?|dollars?|naira|cedis?|rupees?|euros?)(?![\p{L}])(?![^\S\n]*\d)/iu,
  new RegExp(String.raw`^[^\S\n]*(?:${CODES}|F)(?![\p{L}\p{N}])(?![^\S\n]*\d)`, 'u'),
];

/**
 * The phone number inside one PHONE run, as [start, end] within the run, or null when the run holds none. Eight digits
 * or more (Burkina Faso, Mali, Niger, Togo and Botswana numbers have eight), once these are left out:
 * - a price with cents at either end ("Airtime 5.00 0771234567"), or a whole list of them ("12.50 25.00 37.50");
 * - an amount before a number that opens with its trunk 0 or holds eight digits on its own ("KSh 1000 0712345678",
 *   "$5 771234567"), unless the whole run is grouped in thousands ("1 500 000 000");
 * - a date or two ("12/11/2026", "2026-11-12", "12/11-15/11");
 * - with `around`, an amount: ten digits or fewer with no leading 0, + or bracket, written plain or in thousands, with a
 *   money mark right before it or a currency right after it ("UGX 25 000 000", "25000000 shillings"). With no money
 *   beside it, such a run is taken out: a phone that stays is worse than an amount that goes.
 */
function phoneIn(run: string, around?: { before: string; after: string }): [number, number] | null {
  // The groups the run's spaces make, each with where it starts.
  const groups = [...run.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
  let first = 0;
  let last = groups.length - 1;
  const body = (a: number, b: number) => (a > b ? '' : run.slice(groups[a].at, groups[b].at + groups[b].text.length));
  while (first <= last && PRICE.test(groups[first].text)) first++;
  while (last >= first && PRICE.test(groups[last].text)) last--;
  if (first > last) return null;
  if (
    first < last &&
    !THOUSANDS.test(body(first, last)) &&
    /^\d+$/.test(groups[first].text) &&
    (/^0/.test(groups[first + 1].text) || digitCount(groups[first + 1].text) >= 8) &&
    digitCount(body(first + 1, last)) >= 8
  ) {
    first++;
  }
  const s = body(first, last);
  if (digitCount(s) < 8 || DATE.test(s)) return null;
  if (around && /^[1-9]/.test(s) && digitCount(s) <= 10 && (/^\d+$/.test(s) || THOUSANDS.test(s))) {
    const before = around.before + run.slice(0, groups[first].at);
    const after = run.slice(groups[last].at + groups[last].text.length) + around.after;
    if (MONEY_BEFORE.test(before) || MONEY_AFTER.some((re) => re.test(after))) return null;
  }
  return [groups[first].at, groups[last].at + groups[last].text.length];
}

/** Each PHONE run in `text` with the phone inside it, if any: [run start, phone start, phone end] in `text`. */
function phonesIn(text: string): { phone: string; start: number; end: number }[] {
  const out: { phone: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(PHONE)) {
    const at = m.index ?? 0;
    const hit = phoneIn(m[0], { before: text.slice(Math.max(0, at - 8), at), after: text.slice(at + m[0].length, at + m[0].length + 12) });
    if (hit) out.push({ phone: m[0].slice(hit[0], hit[1]), start: at + hit[0], end: at + hit[1] });
  }
  return out;
}

/** Replace each phone in `text` with what `swap` gives for it. */
function replacePhones(text: string, swap: (phone: string) => string): string {
  let out = '';
  let from = 0;
  for (const p of phonesIn(text)) {
    out += text.slice(from, p.start) + swap(p.phone);
    from = p.end;
  }
  return out + text.slice(from);
}

/** A phone number's digits with the leading + and zeros gone, so "0771234567" and the device's 771234567 match. */
const phoneDigits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

/**
 * A phone written the way a phone is ("077 123 4567", "+263...", "(077) 123-4567", "0771234567"). A plain run with no
 * leading 0 ("1500000000") is how the device prints an amount, so it is not one.
 */
const looksLikePhone = (s: string) => /\D/.test(s) || /^0/.test(s);

/**
 * The placeholder of the owner's phone that these digits are, wholly or in part (six digits or more), or undefined.
 * The device prints a number it read as plain digits, and its number reader may split "077 123 4567" into 77123456.
 */
function mappedPhone(digits: string, map: Record<string, string>): string | undefined {
  if (digits.length < 6) return undefined;
  return Object.entries(map).find(([k, v]) => {
    const pd = phoneDigits(v);
    return k.startsWith('[PHONE_') && pd.length >= 6 && (pd.includes(digits) || digits.includes(pd));
  })?.[0];
}

/** Capitalised words that are not names in a shop's sentence. */
const NOT_NAMES = new Set(
  (
    'I Sold Bought Paid Took Gave Owes Owe Will Pays Pay Today Yesterday Tomorrow Monday Tuesday Wednesday Thursday ' +
    'Friday Saturday Sunday January February March April May June July August September October November December ' +
    'She He They We My The A An And At For To From Of On In With Cash Card Bread Sugar Rice Milk Eggs Airtime ' +
    'Coca Cola Coke Cokes Fanta Sprite USD ZAR KES INR XOF ZWG R Rs KSh CFA Vendu Payé Acheté Il Elle Le La Les Un Une Et ' +
    'Pour Avec Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche Ngithengise Ngikhokhile Nimeuza Nimelipa ' +
    'Jumatatu Jumanne Jumatano Alhamisi Ijumaa Jumamosi Jumapili Leo Jana Kesho FCFA'
  ).split(' '),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A known full name whose parts sit next to each other with a few other marks between them ("thandi. moyo",
 * "thandi__moyo", "thandi - moyo", "Paid Thandi. Moyo owes"), which the full-name pattern misses. Each part then gets
 * its own placeholder, so two people stay two. A part alone ("never" for "Never Moyo") is an ordinary word and stays.
 * Up to eight marks that are not letters may sit between the parts ("thandi . . moyo", "thandi2moyo").
 */
function splitName(name: string): RegExp | null {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || /\d/.test(name)) return null; // a phone number is not a name
  const body = words.map((w) => `(${escape(w)})`).join('([^\\p{L}]{1,8})');
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L}|_\\d+\\])`, 'giu');
}

/** Swap each part of one known full name written split; `keyFor` gives a part's placeholder. */
function swapSplitName(text: string, name: string, keyFor: (part: string) => string): string {
  const re = splitName(name);
  if (!re) return text;
  return text.replace(re, (...g) => {
    const groups = g.slice(1, -2) as string[];
    return groups.map((x, i) => (i % 2 === 0 ? keyFor(x) : x)).join('');
  });
}

/**
 * A pattern that finds `text` with no letter touching it, accented letters counted as letters. "Tom" is not found in
 * "tomorrow", nor "Juma" in "Ijumaa" (Kiswahili for Friday), nor "Phone" inside a "[PHONE_1]" placeholder; "Aimé" is
 * found before a comma, and "Thandi" in "Thandi2" and "thandi_m", since a digit or an underscore is not part of a name.
 * Only the placeholder shape (an underscore, digits and "]") is skipped, so a name joined by an underscore still goes,
 * and the parts of a full name match across spaces or one underscore, dot or hyphen ("thandi_moyo" for "Thandi Moyo").
 */
export function wholeWord(text: string, flags = 'iu'): RegExp {
  // A full name may be written as one handle ("thandi_moyo", "thandi.moyo") or "thandi-moyo", or with more than
  // one space; one joiner only, so "Thandi. Moyo" across a full stop stays two names.
  if (!text.trim()) return new RegExp('(?!)', flags); // a blank name matches nothing
  const body = escape(text.trim()).split(/\s+/).join('(?:\\s+|[_.-])');
  return new RegExp(`(?<!\\p{L})${body}(?!\\p{L}|_\\d+\\])`, flags);
}

/**
 * Replace the names of people the book already knows, any other capitalised word that looks like a name, and
 * phone numbers. `known` is the list of customer and supplier names already in the book.
 */
export function redact(text: string, known: string[] = []): Redacted {
  const map: Record<string, string> = {};
  const parts = new Set<string>();
  let out = text;
  let n = 0;
  const keyFor = (name: string) => {
    const existing = Object.entries(map).find(([, v]) => v.toLowerCase() === name.toLowerCase());
    const key = existing ? existing[0] : `[PERSON_${++n}]`;
    map[key] = existing ? existing[1] : name;
    return key;
  };
  const swap = (name: string) => {
    const key = keyFor(name);
    parts.delete(key); // a name in its own right now, wherever it stands
    out = out.replace(wholeWord(name, 'giu'), key);
  };
  const partKey = (part: string) => {
    const had = Object.entries(map).some(([, v]) => v.toLowerCase() === part.toLowerCase());
    const key = keyFor(part);
    if (!had) parts.add(key);
    return key;
  };
  // Longest names first, so "Thandi Moyo", whole or written split, goes before "Thandi".
  for (const name of [...known].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (wholeWord(name).test(out)) swap(name);
    out = swapSplitName(out, name, partKey);
  }
  // Capitalised words not at the start of a sentence and not a known shop word.
  for (const m of out.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-zà-ÿ'’-]{1,})(?:\s([A-Z][a-zà-ÿ'’-]{1,}))?/gu)) {
    const words = [m[1], m[2]].filter(Boolean) as string[];
    const name = words.filter((w) => !NOT_NAMES.has(w)).join(' ');
    if (name && !name.startsWith('[')) swap(name);
  }
  // A capitalised word that opens a sentence is a name when a person's verb follows it ("Thandi paid R30").
  for (const m of out.matchAll(
    /(?:^|[.!?]\s+)([A-Z][a-zà-ÿ'’-]{1,})\s+(?:paid|pays|owes|owe|took|bought|borrowed|will|has|a payé|doit|ukweleta|ukhokhile|amelipa|anadaiwa)(?![\p{L}\p{N}_])/gu,
  )) {
    if (!NOT_NAMES.has(m[1])) swap(m[1]);
  }
  let p = 0;
  out = replacePhones(out, (phone) => {
    const key = `[PHONE_${++p}]`;
    map[key] = phone;
    return key;
  });
  return { text: out, map, parts: [...parts] };
}

/**
 * Take out of text the device wrote (its problem lines) the names already removed from the owner's words, and any
 * known customer, with the same placeholders. New placeholders are added to `red.map`. The capitalised-word rule is
 * not used here: the device writes item names with capitals ("Loaves"), and those are not people.
 */
export function redactAlso(text: string, red: Redacted, known: string[] = []): string {
  let out = text;
  const parts = new Set(red.parts ?? []);
  const keyFor = (name: string, part: boolean) => {
    let key = Object.entries(red.map).find(([, v]) => v.toLowerCase() === name.toLowerCase())?.[0];
    if (!key) {
      key = `[PERSON_${Object.keys(red.map).filter((k) => k.startsWith('[PERSON_')).length + 1}]`;
      red.map[key] = name;
      if (part) parts.add(key);
    }
    return key;
  };
  // One list, longest first, so "Thandi Moyo", whole or written split, goes before "Thandi" whichever list each came
  // from. A split part's placeholder is not a name here: "never" stays in "price never given".
  const names = new Map<string, string>();
  for (const [k, v] of Object.entries(red.map)) if (v && !parts.has(k)) names.set(v.toLowerCase(), v);
  for (const n of known) if (n) names.set(n.toLowerCase(), n);
  for (const name of [...names.values()].sort((a, b) => b.length - a.length)) {
    if (wholeWord(name).test(out)) out = out.replace(wholeWord(name, 'giu'), keyFor(name, false));
    out = swapSplitName(out, name, (part) => keyFor(part, true));
  }
  // A phone number the device read as a quantity or a total comes back printed as plain digits ("771234567" for the
  // owner's "0771234567", or part of it): it takes the owner's placeholder. Anything else written as a phone gets one of
  // its own; a plain amount ("1500000000") stays, since the second opinion needs it.
  out = replacePhones(out, (phone) => {
    const key = mappedPhone(phoneDigits(phone), red.map);
    if (key) return key;
    if (!looksLikePhone(phone)) return phone;
    const own = `[PHONE_${Object.keys(red.map).filter((k) => k.startsWith('[PHONE_')).length + 1}]`;
    red.map[own] = phone;
    return own;
  });
  // A shorter run that is part of the owner's phone ("123 4567" of "077 123 4567").
  out = out.replace(PHONE, (match) => mappedPhone(phoneDigits(match), red.map) ?? match);
  out = out.replace(/(?<!\d)\d{6,}(?!\d)/g, (run) => mappedPhone(phoneDigits(run), red.map) ?? run);
  red.parts = [...parts];
  return out;
}

/**
 * The forms of one placeholder a cloud model writes without its brackets ("PERSON_1", "{PERSON_1}", "Person 1"). The
 * digit must end there, so PERSON_1 never takes PERSON_10. "Person 1" is how a model may rewrite a name's placeholder,
 * so PERSON is matched in any case; "phone 1" is an ordinary phrase ("phone 1 charger"), so any other kind is matched
 * only in capitals or with its underscore.
 */
function bareForms(kind: string, n: string, said = ''): RegExp[] {
  const edged = (body: string, flags: string) => new RegExp(`[[{<]?\\b${body}\\b[\\]}>]?`, flags);
  if (kind === 'PERSON') return [edged(`${kind}[\\s_-]?${n}`, 'gi')];
  const forms = [edged(`${kind}[\\s_-]?${n}`, 'g'), edged(`${kind}_${n}`, 'gi')];
  // A field that is nothing but the placeholder ("Phone 1" as the person) is one in any case, unless the owner wrote
  // those words themselves ("Sold Phone 1 to ..."), when it is their item.
  if (!new RegExp(`\\b${kind}[\\s_-]?${n}\\b`, 'i').test(said)) forms.push(new RegExp(`^\\s*[[{<]?${kind}[\\s_-]?${n}[\\]}>]?\\s*$`, 'i'));
  return forms;
}

/** Put the real names back into anything the cloud returned. `said` is the owner's own text that was redacted. */
export function restore<T>(value: T, map: Record<string, string>, said = ''): T {
  if (typeof value === 'string') {
    let s: string = value;
    for (const [k, v] of Object.entries(map)) {
      s = s.split(k).join(v);
      // A cloud model sometimes drops the brackets or swaps them, as gemini-3.5-flash-lite did for the Kiswahili
      // example on 12 Nov 2026 ("PERSON_1").
      const m = /^\[([A-Z]+)_(\d+)\]$/.exec(k);
      if (m) for (const re of bareForms(m[1], m[2], said)) s = s.replace(re, () => v);
    }
    return s as T;
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, map, said)) as T;
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = restore(v, map, said);
    return o as T;
  }
  return value;
}

/**
 * A placeholder still in a restored answer, in any of the forms a model writes one ("[PERSON_3]", "PERSON1",
 * "Person 1", "PERSON_1s"), or null. Such an answer names nobody the owner knows, so it must not count as checked.
 */
export function placeholderIn(value: unknown, phoneSent?: (hit: string) => boolean): string | null {
  if (typeof value === 'string') {
    return (
      /\bPERSON[\s_-]?\d+/i.exec(value)?.[0] ??
      /\bPHONE[\s_-]?\d+/.exec(value)?.[0] ??
      /\bphone_\d+/i.exec(value)?.[0] ??
      // "Phone 1" as the whole value is a phone placeholder rewritten (only one `phoneSent` accepts, when given), and
      // inside a value only when `phoneSent` says so.
      [/^\s*[[{<]?(phone[\s_-]?\d+)[\]}>]?\s*$/i.exec(value)?.[1]].find((h) => h && (!phoneSent || phoneSent(h))) ??
      [...value.matchAll(/\bphone[\s_-]?\d+\b/gi)].map((m) => m[0]).find((h) => phoneSent?.(h)) ??
      null
    );
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = placeholderIn(v, phoneSent);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') return placeholderIn(Object.values(value), phoneSent);
  return null;
}

/**
 * A placeholder the cloud's answer still holds once every placeholder in the map is taken out, or null. It is read
 * before the real values go back, so a phone number the owner wrote after the word "phone" is not taken for one.
 */
export function placeholderLeft(value: unknown, map: Record<string, string>, said = ''): string | null {
  // "Phone 2" inside a value is a placeholder only when [PHONE_2] was sent and the owner did not write it themselves
  // ("a phone 2 cover").
  const phoneSent = (hit: string) => {
    const n = /\d+/.exec(hit)?.[0];
    return !!n && `[PHONE_${n}]` in map && !new RegExp(`\\bphone[\\s_-]?${n}\\b`, 'i').test(said);
  };
  return placeholderIn(restore(value, Object.fromEntries(Object.keys(map).map((k) => [k, ''])), said), phoneSent);
}

/**
 * True when no phone number of any kind and no original name in the map is still in the text as a word of its own,
 * and no known or mapped full name is still there written split. A placeholder in `parts` holds one part of a split name, and that
 * word alone is an ordinary word, so it is not looked for on its own.
 */
export function isClean(text: string, map: Record<string, string>, parts: string[] = [], known: string[] = []): boolean {
  const skip = new Set(parts);
  const whole = Object.entries(map).filter(([k]) => !skip.has(k)).map(([, v]) => v);
  return (
    // No number written as a phone, and no run of the owner's phone digits, whole or in part.
    !phonesIn(text).some((p) => looksLikePhone(p.phone)) &&
    ![...text.matchAll(/\d{6,}/g)].some((m) => mappedPhone(phoneDigits(m[0]), map)) &&
    whole.every((v) => !wholeWord(v).test(text)) &&
    [...whole, ...known].every((v) => !splitName(v)?.test(text))
  );
}
