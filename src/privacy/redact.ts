// Before any words leave the device for a second opinion, people's names and phone numbers are swapped for
// placeholders. The placeholders come back in the cloud's answer and are swapped back here, on the device.

export interface Redacted {
  text: string;
  /** placeholder -> original, kept on the device only */
  map: Record<string, string>;
}

const PHONE = /(?:\+?\d[\d\s-]{7,}\d)/g;

/** Capitalised words that are not names in a shop's sentence. */
const NOT_NAMES = new Set(
  (
    'I Sold Bought Paid Took Gave Owes Owe Will Pays Pay Today Yesterday Tomorrow Monday Tuesday Wednesday Thursday ' +
    'Friday Saturday Sunday January February March April May June July August September October November December ' +
    'She He They We My The A An And At For To From Of On In With Cash Card Bread Sugar Rice Milk Eggs Airtime ' +
    'Coca Cola Fanta Sprite USD ZAR KES INR XOF ZWG R Rs KSh CFA Vendu Payé Acheté Il Elle Le La Les Un Une Et ' +
    'Pour Avec Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche Ngithengise Ngikhokhile Nimeuza Nimelipa ' +
    'Jumatatu Jumanne Jumatano Alhamisi Ijumaa Jumamosi Jumapili Leo Jana Kesho FCFA'
  ).split(' '),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace the names of people the book already knows, any other capitalised word that looks like a name, and
 * phone numbers. `known` is the list of customer and supplier names already in the book.
 */
export function redact(text: string, known: string[] = []): Redacted {
  const map: Record<string, string> = {};
  let out = text;
  let n = 0;
  const swap = (name: string) => {
    const existing = Object.entries(map).find(([, v]) => v.toLowerCase() === name.toLowerCase());
    const key = existing ? existing[0] : `[PERSON_${++n}]`;
    map[key] = existing ? existing[1] : name;
    out = out.replace(new RegExp(`\\b${escape(name)}\\b`, 'gi'), key);
  };
  // Longest names first, so "Thandi Moyo" goes before "Thandi".
  for (const name of [...known].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${escape(name)}\\b`, 'i').test(out)) swap(name);
  }
  // Capitalised words not at the start of a sentence and not a known shop word.
  for (const m of out.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-zà-ÿ'’-]{1,})(?:\s([A-Z][a-zà-ÿ'’-]{1,}))?/gu)) {
    const words = [m[1], m[2]].filter(Boolean) as string[];
    const name = words.filter((w) => !NOT_NAMES.has(w)).join(' ');
    if (name && !name.startsWith('[')) swap(name);
  }
  // A capitalised word that opens a sentence is a name when a person's verb follows it ("Thandi paid R30").
  for (const m of out.matchAll(
    /(?:^|[.!?]\s+)([A-Z][a-zà-ÿ'’-]{1,})\s+(?:paid|pays|owes|owe|took|bought|borrowed|will|has|a payé|doit|ukweleta|ukhokhile|amelipa|anadaiwa)\b/gu,
  )) {
    if (!NOT_NAMES.has(m[1])) swap(m[1]);
  }
  let p = 0;
  out = out.replace(PHONE, (match) => {
    const key = `[PHONE_${++p}]`;
    map[key] = match;
    return key;
  });
  return { text: out, map };
}

/** Put the real names back into anything the cloud returned. */
export function restore<T>(value: T, map: Record<string, string>): T {
  if (typeof value === 'string') {
    let s: string = value;
    for (const [k, v] of Object.entries(map)) s = s.split(k).join(v);
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

/** True when no original name or phone number in the map is still in the text. */
export function isClean(text: string, map: Record<string, string>): boolean {
  return Object.values(map).every((v) => !text.toLowerCase().includes(v.toLowerCase()));
}
