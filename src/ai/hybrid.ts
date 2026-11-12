// Hybrid inference with Firebase AI Logic. Every reading starts on the device with Gemini Nano; the cloud model is
// asked only when the device cannot read the input (its language, a voice note, no on-device model) or when the
// device's reading fails the book's checks. Names and phone numbers are removed before anything leaves the device.

import { getGenerativeModel, InferenceMode, type Part } from 'firebase/ai';
import { ai, cloudConfigured, type Settings } from './firebase';
import { askPrompt, QUERY_SCHEMA, READING_SCHEMA, readPrompt, receiptPrompt, receiptSecondOpinionPrompt, secondOpinionPrompt } from './prompts';
import { checkReceipt, checkWords, type CheckResult } from '../check/checks';
import { isClean, placeholderLeft, redact, redactAlso, restore } from '../privacy/redact';
import type { Entry, Hop, Query, Reading, Where } from '../book/types';
import { INTENTS, KINDS, PERIODS } from '../book/types';

export const DEVICE_MODEL = 'Gemini Nano';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface LanguageModelLike {
  availability(o?: object): Promise<Availability>;
}
interface DetectorLike {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
const g = globalThis as unknown as {
  LanguageModel?: LanguageModelLike;
  LanguageDetector?: { availability(): Promise<Availability>; create(): Promise<DetectorLike> };
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', es: 'Spanish', ja: 'Japanese', pt: 'Portuguese', sw: 'Kiswahili', zu: 'isiZulu',
  xh: 'isiXhosa', sn: 'chiShona', nd: 'isiNdebele', tn: 'Setswana', st: 'Sesotho', af: 'Afrikaans', hi: 'Hindi',
  rw: 'Kinyarwanda', wo: 'Wolof', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo', am: 'Amharic', ar: 'Arabic',
};
export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code;

export interface Context {
  settings: Settings;
  shopCurrency: string;
  /** Names of people already in the book, so they are always removed before a cloud call. */
  knownNames: string[];
  /** Told each step as it starts, so the screen can say what is happening. */
  onStep?: (text: string) => void;
}

// ---- the device ---------------------------------------------------------------------------------------------------

/** What Chrome says about Gemini Nano on this device for plain English text. */
export async function deviceStatus(): Promise<Availability | 'no-api'> {
  if (!g.LanguageModel) return 'no-api';
  try {
    return await g.LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }] });
  } catch {
    return 'unavailable';
  }
}

/** Download Gemini Nano if needed. Chrome only allows this right after a click or a key press. */
export async function prepareDevice(onProgress: (share: number) => void): Promise<void> {
  const model = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  await model.initializeDeviceModel(onProgress);
}

let detector: Promise<DetectorLike | null> | null = null;

/** The language of the words, found on the device with Chrome's language detector. */
export async function detectLanguage(text: string): Promise<{ code: string; confidence: number }> {
  detector ??= (async () => {
    try {
      if (!g.LanguageDetector || (await g.LanguageDetector.availability()) === 'unavailable') return null;
      return await g.LanguageDetector.create();
    } catch {
      return null;
    }
  })();
  const d = await detector;
  if (!d) return { code: 'en', confidence: 0 };
  const [top] = await d.detect(text);
  if (!top || top.detectedLanguage === 'und') return { code: 'en', confidence: 0 };
  return { code: top.detectedLanguage.split('-')[0], confidence: top.confidence };
}

/**
 * The language to route by. Chrome's detector is often wrong on a short message ("Thandi paid R30" came back as
 * Hindi at 0.55), so the cloud is chosen for the language alone only when the detector is sure (0.9 or more) of a
 * language Gemini Nano does not read. Anything less is tried on the device first, and the checks judge the result.
 */
export async function pickLanguage(text: string): Promise<{ code: string; sure: boolean }> {
  const lang = await detectLanguage(text);
  if (await deviceReads(lang.code)) return { code: lang.code, sure: true };
  if (lang.confidence >= 0.9) return { code: lang.code, sure: true };
  return { code: 'en', sure: false };
}

/** Whether Gemini Nano on this device can read this language (and photos, when asked). */
export async function deviceReads(language: string, image = false): Promise<boolean> {
  if (!g.LanguageModel) return false;
  const expectedInputs: object[] = [{ type: 'text', languages: [language] }];
  if (image) expectedInputs.push({ type: 'image' });
  try {
    return (await g.LanguageModel.availability({ expectedInputs, expectedOutputs: [{ type: 'text', languages: ['en'] }] })) === 'available';
  } catch {
    return false;
  }
}

/** Why the device cannot take this language, in words the owner sees. */
async function whyNotDevice(language: string): Promise<string> {
  const status = await deviceStatus();
  if (status === 'no-api') return `this browser has no ${DEVICE_MODEL}`;
  if (status !== 'available') return `${DEVICE_MODEL} is not ready on this device`;
  return `${DEVICE_MODEL} on this device does not read ${languageName(language)}`;
}

// ---- the cloud budget -------------------------------------------------------------------------------------------

const dayKey = () => `imali-cloud-calls-${new Date().toISOString().slice(0, 10)}`;

export function cloudCallsToday(): number {
  return Number(localStorage.getItem(dayKey()) ?? 0);
}

function countCloudCall() {
  localStorage.setItem(dayKey(), String(cloudCallsToday() + 1));
}

/** Why the cloud cannot be asked right now, or null when it can. */
export function cloudBlocked(ctx: Context): string | null {
  if (!cloudConfigured) return 'no Firebase project is set up for this copy';
  if (!navigator.onLine) return 'this device is offline';
  if (!ctx.settings.secondOpinion) return 'cloud second opinions are switched off';
  if (cloudCallsToday() >= ctx.settings.maxCloudCallsPerDay) return "today's cloud calls are used up";
  return null;
}

// ---- one model call -----------------------------------------------------------------------------------------------

interface CallResult<T> {
  value: T;
  where: Where;
  model: string;
  ms: number;
  /** The model asked first when it did not answer and the fallback model gave this result instead. */
  missed?: string;
}

/**
 * How long one cloud call may take until its answer starts: 60 seconds for words, 120 for a photo, which also has to
 * upload. The SDK's own default is 180 seconds, too long for an owner at the counter waiting on a model that is down.
 * A fallback call gets what is left of 90 seconds for words (180 for a photo), and never less than 30 (60), so the two
 * calls together never take longer than that.
 */
export const CLOUD_TIMEOUT_MS = 60_000;
export const PHOTO_TIMEOUT_MS = 120_000;
export const CLOUD_BUDGET_MS = 90_000;
export const PHOTO_BUDGET_MS = 180_000;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(t);
}

async function call<T>(
  parts: Part[],
  opts: {
    mode: InferenceMode;
    language: string;
    image?: boolean;
    cloudModel: string;
    schema: Record<string, unknown>;
    timeout?: number;
    /** For PREFER_ON_DEVICE: this device has no Gemini Nano for the input, so the call will go to the cloud. */
    cloudLikely?: boolean;
  },
): Promise<CallResult<T>> {
  const expectedInputs: { type: 'text' | 'image'; languages?: string[] }[] = [{ type: 'text', languages: [opts.language] }];
  if (opts.image) expectedInputs.push({ type: 'image' });
  const model = getGenerativeModel(
    ai,
    {
      mode: opts.mode,
      onDeviceParams: {
        createOptions: { expectedInputs, expectedOutputs: [{ type: 'text', languages: ['en'] }] },
        promptOptions: { responseConstraint: opts.schema },
      },
      inCloudParams: {
        model: opts.cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: opts.schema, temperature: 0 },
      },
    },
    { timeout: opts.timeout ?? (opts.image ? PHOTO_TIMEOUT_MS : CLOUD_TIMEOUT_MS) },
  );
  // A cloud call is counted before it is made: one that times out or fails has still used the day's free quota, and
  // counting only answers would let the loop over waiting entries ask a model that is down without end.
  const counted = opts.mode === InferenceMode.ONLY_IN_CLOUD || opts.cloudLikely === true;
  if (counted) countCloudCall();
  const t0 = performance.now();
  const result = await model.generateContent(parts);
  const ms = Math.round(performance.now() - t0);
  const where: Where = result.response.inferenceSource === 'on_device' ? 'device' : 'cloud';
  if (where === 'cloud' && !counted) countCloudCall();
  return { value: parseJson(result.response.text()) as T, where, model: where === 'device' ? DEVICE_MODEL : opts.cloudModel, ms };
}

/**
 * A cloud call on the chosen model, then once on the fallback model when the first one gives no usable answer (a
 * timeout, an overloaded or retired model, no free quota for it, or an answer that is not the form asked for). On the
 * Gemini Developer API's free tier a larger model can stop answering for minutes while a smaller one still does, and a
 * second opinion that never arrives leaves the entry waiting. The fallback's answer goes through the same checks.
 */
async function cloudCall<T>(
  parts: Part[],
  ctx: Context,
  opts: {
    language: string;
    image?: boolean;
    cloudModel: string;
    fallbackModel?: string;
    schema: Record<string, unknown>;
    /** The first call's limit, when an earlier call already used part of the budget. */
    timeout?: number;
  },
): Promise<CallResult<T>> {
  const { fallbackModel, ...rest } = opts;
  const once = (cloudModel: string, timeout?: number) =>
    call<T>(parts, { ...rest, mode: InferenceMode.ONLY_IN_CLOUD, cloudModel, timeout });
  const t0 = performance.now();
  try {
    return await once(opts.cloudModel, opts.timeout);
  } catch (e) {
    // The fallback is a second cloud call, so it needs what the first one needed: a connection and today's cap.
    if (!fallbackModel || fallbackModel === opts.cloudModel || cloudBlocked(ctx)) throw e;
    const budget = opts.image ? PHOTO_BUDGET_MS : CLOUD_BUDGET_MS;
    const first = opts.image ? PHOTO_TIMEOUT_MS : CLOUD_TIMEOUT_MS;
    const r = await once(fallbackModel, Math.round(Math.max(budget - first, budget - (performance.now() - t0))));
    // The owner waited for both calls, so the step shows both.
    return { ...r, missed: opts.cloudModel, ms: Math.round(performance.now() - t0) };
  }
}

/** The hop's reason, saying so when the chosen cloud model did not answer and the fallback did. */
const because = (reason: string, r: CallResult<unknown>) =>
  r.missed ? `${reason}; ${r.missed} did not answer, so ${r.model} was asked` : reason;

// ---- tidying what a model returns ---------------------------------------------------------------------------------

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * What a model may write for a currency instead of its code, each as the whole value. Gemini Nano wrote "CFA" for
 * "5000 FCFA chacun" on 12 Nov 2026, which the currency check then failed against the XOF the words name, and the
 * read prompt itself says "shillings is KES" and "dollars is USD". Only these exact forms are read, so a country's
 * name picks its own currency ("Tanzanian shillings" is TZS) and "Z$" or "Australian dollars" never become US dollars.
 */
const CURRENCY_FORMS: [RegExp, string][] = [
  [/^(?:francs?\s+)?F?\s?CFA(?:\s+francs?)?$/i, 'XOF'],
  [/^(?:K\.?\s?Shs?\.?|(?:Kenyan\s+)?shillings?)$/i, 'KES'],
  [/^(?:T\.?\s?Shs?\.?|Tanzanian\s+shillings?)$/i, 'TZS'],
  [/^(?:U\.?\s?Shs?\.?|Ugandan\s+shillings?)$/i, 'UGX'],
  [/^ZiG$/i, 'ZWG'],
  [/^(?:R|(?:South\s+African\s+)?rands?)$/i, 'ZAR'],
  [/^(?:Rs\.?|₹|(?:Indian\s+)?rupees?)$/i, 'INR'],
  [/^(?:\$|US\$|(?:US\s?|American\s+)?dollars?)$/i, 'USD'],
  [/^(?:€|euros?)$/i, 'EUR'],
  [/^(?:₦|(?:Nigerian\s+)?naira)$/i, 'NGN'],
  [/^(?:(?:GH)?₵|(?:Ghanaian\s+)?cedis?)$/i, 'GHS'],
];

/** The model's currency as a three-letter code; anything else is left to fail the currency check. */
export function currencyCode(v: string | null, shopCurrency: string): string {
  if (!v) return shopCurrency;
  const t = v.trim();
  for (const [re, code] of CURRENCY_FORMS) if (re.test(t)) return code;
  // Anything else is kept whole: cut to three letters, "Australian dollars" would pass the check as "AUS".
  return t.toUpperCase();
}

export function tidyReading(raw: unknown, shopCurrency: string): Reading {
  const o = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items : [];
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    kind: (KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as Reading['kind']) : 'sale',
    items: items.map((i) => {
      const it = (i ?? {}) as Record<string, unknown>;
      return { name: text(it.name) ?? 'item', quantity: num(it.quantity), unit_price: num(it.unit_price), line_total: num(it.line_total) };
    }),
    total: num(o.total),
    currency: currencyCode(text(o.currency), shopCurrency),
    person: text(o.person),
    due: text(o.due),
  };
}

function tidyQuery(raw: unknown): Query {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    intent: (INTENTS as readonly string[]).includes(String(o.intent)) ? (o.intent as Query['intent']) : 'who_owes',
    person: s(o.person),
    item: s(o.item),
    period: (PERIODS as readonly string[]).includes(String(o.period)) ? (o.period as Query['period']) : 'all',
  };
}

const hop = (step: Hop['step'], r: { where: Where; model: string; ms: number }, reason: string, sent = ''): Hop => ({
  at: Date.now(),
  step,
  where: r.where,
  model: r.model,
  ms: r.ms,
  reason,
  sent,
});

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---- reading the owner's words ------------------------------------------------------------------------------------

/** Ask the cloud for a reading of the words with names removed, then check it here. */
async function cloudRead(
  words: string,
  ctx: Context,
  problems: string[] | null,
  reason: string,
): Promise<{ reading: Reading; check: CheckResult; hop: Hop }> {
  // The owner's words lose their names first; the device's problem lines (which quote item names from its reading)
  // then lose the same names, with the same placeholders. The guard reads only these parts: the fixed instructions
  // hold example names such as Sipho, which must not stop an entry about a real Sipho.
  const red = redact(words, ctx.knownNames);
  const lines = (problems ?? []).map((p) => redactAlso(p, red, ctx.knownNames));
  if (!isClean([red.text, ...lines].join('\n'), red.map, red.parts, ctx.knownNames)) throw new Error('A name was still in the words; nothing was sent.');
  const prompt = problems ? secondOpinionPrompt(red.text, ctx.shopCurrency, lines) : readPrompt(red.text, ctx.shopCurrency);
  const r = await cloudCall<unknown>([{ type: 'text', text: prompt }], ctx, {
    language: 'en',
    cloudModel: problems ? ctx.settings.secondOpinionModel : ctx.settings.cloudModel,
    fallbackModel: problems ? ctx.settings.cloudModel : ctx.settings.secondOpinionModel,
    schema: READING_SCHEMA,
  });
  const tidied = tidyReading(r.value, ctx.shopCurrency);
  const reading = restore(tidied, red.map);
  const n = Object.keys(red.map).length;
  const sent = `the words, with ${n === 0 ? 'no names to remove' : n === 1 ? '1 name removed' : `${n} names removed`}`;
  const check = checkWords(reading, words);
  const left = placeholderLeft(tidied, red.map);
  if (left) {
    check.ok = false;
    check.problems.push(`The cloud's answer still holds "${left}" where a name was taken out, so the name is not known.`);
  }
  return { reading, check, hop: hop(problems ? 'second-opinion' : 'read', r, because(reason, r), sent) };
}

export async function readWords(words: string, ctx: Context): Promise<Entry> {
  const lang = await pickLanguage(words);
  const entry: Entry = {
    id: newId(),
    createdAt: Date.now(),
    source: 'words',
    words,
    language: lang.code,
    languageSure: lang.sure,
    reading: { kind: 'sale', items: [], total: 0, currency: ctx.shopCurrency, person: null, due: null },
    status: 'waiting',
    problems: [],
    hops: [],
  };
  return finishWords(entry, ctx);
}

/** Read (or re-read) an entry's words: on the device first, then the cloud only if needed and allowed. */
export async function finishWords(entry: Entry, ctx: Context): Promise<Entry> {
  const words = entry.words;
  const onDevice = await deviceReads(entry.language);
  let first: { reading: Reading; check: CheckResult } | null = entry.reading.items.length
    ? { reading: entry.reading, check: checkWords(entry.reading, words) }
    : null;

  if (!first && onDevice) {
    try {
      ctx.onStep?.(`${DEVICE_MODEL} is reading it on this device`);
      const r = await call<unknown>([{ type: 'text', text: readPrompt(words, ctx.shopCurrency) }], {
        mode: InferenceMode.ONLY_ON_DEVICE,
        language: entry.language,
        cloudModel: ctx.settings.cloudModel,
        schema: READING_SCHEMA,
      });
      const reading = tidyReading(r.value, ctx.shopCurrency);
      first = { reading, check: checkWords(reading, words) };
      entry.hops.push(hop('read', r, entry.languageSure === false ? 'the language was unclear, so it tried here first' : `it reads ${languageName(entry.language)} here`));
    } catch (e) {
      entry.problems = [`${DEVICE_MODEL} could not read it on this device (${(e as Error).message}).`];
    }
  }

  ctx.onStep?.('Checking the sums');
  if (first?.check.ok) {
    entry.reading = first.reading;
    entry.problems = [];
    entry.status = 'checked';
    return entry;
  }

  const why = first
    ? `the device's reading failed ${first.check.problems.length === 1 ? 'a check' : `${first.check.problems.length} checks`}`
    : onDevice
      ? `${DEVICE_MODEL} could not read it`
      : await whyNotDevice(entry.language);
  const blocked = cloudBlocked(ctx);
  if (blocked) {
    if (first) entry.reading = first.reading;
    entry.problems = first ? first.check.problems : entry.problems.length ? entry.problems : [`Waiting: ${why}.`];
    entry.status = 'waiting';
    entry.problems.push(`Kept on this device until the cloud can check it: ${blocked}.`);
    return entry;
  }

  try {
    ctx.onStep?.(first ? 'A check failed: asking the cloud for a second opinion, names taken out' : 'Asking the cloud, names taken out');
    const second = await cloudRead(words, ctx, first ? first.check.problems : null, why);
    entry.hops.push(second.hop);
    if (first) entry.firstReading = first.reading;
    entry.reading = second.reading;
    entry.problems = second.check.problems;
    entry.status = second.check.ok ? (first ? 'checked-in-cloud' : 'checked') : 'needs-you';
  } catch (e) {
    if (first) entry.reading = first.reading;
    entry.problems = [...(first?.check.problems ?? []), `The cloud could not be reached (${(e as Error).message}).`];
    entry.status = 'waiting';
  }
  return entry;
}

// ---- reading a receipt photo --------------------------------------------------------------------------------------

/** Shrink the photo and turn it into a JPEG, which both Gemini Nano and the cloud model accept. */
export async function toJpeg(file: Blob, maxSide = 1280): Promise<{ base64: string; dataUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  return { base64: dataUrl.split(',')[1], dataUrl };
}

export async function readReceipt(file: Blob, ctx: Context): Promise<Entry> {
  const { base64 } = await toJpeg(file);
  const image: Part = { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: base64 } };
  const entry: Entry = {
    id: newId(),
    createdAt: Date.now(),
    source: 'receipt',
    words: 'Receipt photo',
    language: 'en',
    reading: { kind: 'purchase', items: [], total: 0, currency: ctx.shopCurrency, person: null, due: null },
    status: 'waiting',
    problems: [],
    hops: [],
  };
  // A receipt carries no customer names, so the SDK's own hybrid mode decides: Gemini Nano when this device has it,
  // the cloud model when it does not (or while offline, an error the owner sees).
  let first: { reading: Reading; check: CheckResult; where: Where } | null = null;
  const canCloud = cloudBlocked(ctx) === null;
  const deviceFirst = await deviceReads('en', true);
  const tPhoto = performance.now();
  if (deviceFirst || canCloud) {
    try {
      ctx.onStep?.('Reading the receipt photo');
      const r = await call<unknown>([{ type: 'text', text: receiptPrompt(ctx.shopCurrency) }, image], {
        mode: InferenceMode.PREFER_ON_DEVICE,
        language: 'en',
        image: true,
        cloudModel: ctx.settings.cloudModel,
        schema: READING_SCHEMA,
        cloudLikely: !deviceFirst,
      });
      const reading = tidyReading(r.value, ctx.shopCurrency);
      first = { reading, check: checkReceipt(reading), where: r.where };
      entry.hops.push(
        r.where === 'device'
          ? hop('receipt', r, 'it reads photos here')
          : hop('receipt', r, `prefer on device: no ${DEVICE_MODEL} here, so Firebase AI Logic used the cloud`, 'the receipt photo'),
      );
    } catch (e) {
      entry.problems = [`The photo could not be read (${(e as Error).message}).`];
    }
  }
  if (first && first.where === 'cloud') {
    entry.reading = first.reading;
    entry.problems = first.check.problems;
    entry.status = first.check.ok ? 'checked' : 'needs-you';
    return entry;
  }
  if (first?.check.ok) {
    entry.reading = first.reading;
    entry.status = 'checked';
    return entry;
  }
  // With no Gemini Nano for photos, the first pass already asked the cloud model, so the next try goes to the other one.
  const cloudTried = !first && !deviceFirst;
  const why = first
    ? `the lines on the device's reading did not add up`
    : cloudTried
      ? `${ctx.settings.cloudModel} could not read the photo`
      : `${DEVICE_MODEL} could not read the photo here`;
  const blocked = cloudBlocked(ctx);
  if (blocked) {
    if (first) entry.reading = first.reading;
    entry.problems = [...(first?.check.problems ?? entry.problems), `Kept on this device: ${blocked}.`];
    entry.status = 'needs-you';
    return entry;
  }
  try {
    ctx.onStep?.(first ? 'The lines did not add up: asking the cloud to read the photo again' : 'Asking the cloud to read the photo');
    const prompt = first ? receiptSecondOpinionPrompt(ctx.shopCurrency, first.check.problems) : receiptPrompt(ctx.shopCurrency);
    const r = await cloudCall<unknown>([{ type: 'text', text: prompt }, image], ctx, {
      language: 'en',
      image: true,
      cloudModel: first || cloudTried ? ctx.settings.secondOpinionModel : ctx.settings.cloudModel,
      fallbackModel: first ? ctx.settings.cloudModel : cloudTried ? undefined : ctx.settings.secondOpinionModel,
      // After a first pass in the cloud, this call is that pass's fallback, so it gets what is left of the budget.
      timeout: cloudTried ? Math.round(Math.max(PHOTO_BUDGET_MS - PHOTO_TIMEOUT_MS, PHOTO_BUDGET_MS - (performance.now() - tPhoto))) : undefined,
      schema: READING_SCHEMA,
    });
    const reading = tidyReading(r.value, ctx.shopCurrency);
    const check = checkReceipt(reading);
    entry.hops.push(hop(first ? 'second-opinion' : 'receipt', r, because(why, r), 'the receipt photo'));
    if (first) entry.firstReading = first.reading;
    entry.reading = reading;
    entry.problems = check.problems;
    entry.status = check.ok ? (first ? 'checked-in-cloud' : 'checked') : 'needs-you';
  } catch (e) {
    if (first) entry.reading = first.reading;
    entry.problems = [...(first?.check.problems ?? []), `The cloud could not be reached (${(e as Error).message}).`];
    entry.status = 'needs-you';
  }
  return entry;
}

// ---- questions about the book -------------------------------------------------------------------------------------

/** Turn a question into a Query. The book itself never goes to any model; only the question can, names removed. */
export async function readQuestion(question: string, ctx: Context): Promise<{ query: Query; hops: Hop[] }> {
  const lang = await pickLanguage(question);
  const today = new Date().toDateString();
  let why = '';
  if (await deviceReads(lang.code)) {
    try {
      ctx.onStep?.(`${DEVICE_MODEL} is reading your question on this device`);
      const r = await call<unknown>([{ type: 'text', text: askPrompt(question, today) }], {
        mode: InferenceMode.ONLY_ON_DEVICE,
        language: lang.code,
        cloudModel: ctx.settings.cloudModel,
        schema: QUERY_SCHEMA,
      });
      return { query: tidyQuery(r.value), hops: [hop('ask', r, lang.sure ? `it reads ${languageName(lang.code)} here` : 'the language was unclear, so it tried here first')] };
    } catch {
      why = `${DEVICE_MODEL} could not read it`;
    }
  }
  why ||= await whyNotDevice(lang.code);
  const blocked = cloudBlocked(ctx);
  if (blocked) throw new Error(`This question needs the cloud (${why}), and ${blocked}.`);
  const red = redact(question, ctx.knownNames);
  if (!isClean(red.text, red.map, red.parts, ctx.knownNames)) throw new Error('A name was still in the question; nothing was sent.');
  const prompt = askPrompt(red.text, today);
  ctx.onStep?.('Asking the cloud what the question means, names taken out');
  const r = await cloudCall<unknown>([{ type: 'text', text: prompt }], ctx, {
    language: 'en',
    cloudModel: ctx.settings.cloudModel,
    fallbackModel: ctx.settings.secondOpinionModel,
    schema: QUERY_SCHEMA,
  });
  const n = Object.keys(red.map).length;
  const tidied = tidyQuery(r.value);
  const left = placeholderLeft(tidied, red.map);
  if (left) throw new Error(`The cloud's answer still holds "${left}" where a name was taken out; ask again with the name.`);
  const query = restore(tidied, red.map);
  return {
    query,
    hops: [hop('ask', r, because(why, r), `the question only, ${n} name${n === 1 ? '' : 's'} removed; no records`)],
  };
}
