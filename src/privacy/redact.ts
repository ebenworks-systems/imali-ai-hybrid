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

const PHONE = /(?:\+?\d[\d\s-]{7,}\d)/g;

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
  out = out.replace(PHONE, (match) => {
    const key = `[PHONE_${++p}]`;
    map[key] = match;
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
  red.parts = [...parts];
  return out;
}

/**
 * The forms of one placeholder a cloud model writes without its brackets ("PERSON_1", "{PERSON_1}", "Person 1"). The
 * digit must end there, so PERSON_1 never takes PERSON_10. "Person 1" is how a model may rewrite a name's placeholder,
 * so PERSON is matched in any case; "phone 1" is an ordinary phrase ("phone 1 charger"), so any other kind is matched
 * only in capitals or with its underscore.
 */
function bareForms(kind: string, n: string): RegExp[] {
  const edged = (body: string, flags: string) => new RegExp(`[[{<]?\\b${body}\\b[\\]}>]?`, flags);
  return kind === 'PERSON' ? [edged(`${kind}[\\s_-]?${n}`, 'gi')] : [edged(`${kind}[\\s_-]?${n}`, 'g'), edged(`${kind}_${n}`, 'gi')];
}

/** Put the real names back into anything the cloud returned. */
export function restore<T>(value: T, map: Record<string, string>): T {
  if (typeof value === 'string') {
    let s: string = value;
    for (const [k, v] of Object.entries(map)) {
      s = s.split(k).join(v);
      // A cloud model sometimes drops the brackets or swaps them, as gemini-3.5-flash-lite did for the Kiswahili
      // example on 12 Nov 2026 ("PERSON_1").
      const m = /^\[([A-Z]+)_(\d+)\]$/.exec(k);
      if (m) for (const re of bareForms(m[1], m[2])) s = s.replace(re, () => v);
    }
    return s as T;
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, map)) as T;
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = restore(v, map);
    return o as T;
  }
  return value;
}

/**
 * A placeholder still in a restored answer, in any of the forms a model writes one ("[PERSON_3]", "PERSON1",
 * "Person 1", "PERSON_1s"), or null. Such an answer names nobody the owner knows, so it must not count as checked.
 */
export function placeholderIn(value: unknown): string | null {
  if (typeof value === 'string') {
    return /\bPERSON[\s_-]?\d+/i.exec(value)?.[0] ?? /\bPHONE[\s_-]?\d+/.exec(value)?.[0] ?? /\bphone_\d+/i.exec(value)?.[0] ?? null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = placeholderIn(v);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') return placeholderIn(Object.values(value));
  return null;
}

/**
 * A placeholder the cloud's answer still holds once every placeholder in the map is taken out, or null. It is read
 * before the real values go back, so a phone number the owner wrote after the word "phone" is not taken for one.
 */
export function placeholderLeft(value: unknown, map: Record<string, string>): string | null {
  return placeholderIn(restore(value, Object.fromEntries(Object.keys(map).map((k) => [k, '']))));
}

/**
 * True when no original name or phone number in the map is still in the text as a word of its own, and no known or
 * mapped full name is still there written split. A placeholder in `parts` holds one part of a split name, and that
 * word alone is an ordinary word, so it is not looked for on its own.
 */
export function isClean(text: string, map: Record<string, string>, parts: string[] = [], known: string[] = []): boolean {
  const skip = new Set(parts);
  const whole = Object.entries(map).filter(([k]) => !skip.has(k)).map(([, v]) => v);
  return (
    whole.every((v) => !wholeWord(v).test(text)) &&
    [...whole, ...known].every((v) => !splitName(v)?.test(text))
  );
}
