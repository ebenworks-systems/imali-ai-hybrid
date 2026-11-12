// The routing between Gemini Nano and the cloud, with the Firebase SDK and Chrome's built-in AI replaced by stubs.
// Each stub call is recorded, so the tests can see which engine ran and exactly what text left the device.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  mode: string;
  prompt: string;
  model?: string;
  timeout?: number;
}
const calls: Call[] = [];
// Cloud models that answer with an error, as gemini-3.8-flash did on the free tier on 12 Nov 2026 (503 after 180 s).
const downModels = new Set<string>();
// Cloud models that answer, slowly, with text that is not the JSON asked for.
const garbageModels = new Set<string>();
// How long a model that is down takes to fail, added to the clock the code reads (a timeout of 60 s, say).
let downMs = 0;
let skippedMs = 0;
const realNow = performance.now.bind(performance);
vi.spyOn(performance, 'now').mockImplementation(() => realNow() + skippedMs);
// Whether Gemini Nano reads photos on this device.
let nanoPhotos = true;
// What each engine answers next: a reading or a query, as the model would return it.
let deviceAnswer: Record<string, unknown> = {};
let cloudAnswer: Record<string, unknown> = {};

vi.mock('./firebase', () => ({ ai: {}, cloudConfigured: true }));
vi.mock('firebase/ai', () => ({
  InferenceMode: {
    PREFER_ON_DEVICE: 'prefer_on_device',
    ONLY_ON_DEVICE: 'only_on_device',
    ONLY_IN_CLOUD: 'only_in_cloud',
    PREFER_IN_CLOUD: 'prefer_in_cloud',
  },
  getGenerativeModel: (
    _ai: unknown,
    params: { mode: string; inCloudParams?: { model?: string } },
    requestOptions?: { timeout?: number },
  ) => ({
    initializeDeviceModel: async () => undefined,
    generateContent: async (parts: { text?: string }[]) => {
      const prompt = parts.map((p) => p.text ?? '').join('\n');
      const model = params.inCloudParams?.model;
      calls.push({ mode: params.mode, prompt, model, timeout: requestOptions?.timeout });
      const onDevice = params.mode === 'only_on_device' || (params.mode === 'prefer_on_device' && nanoPhotos);
      if (!onDevice && model && downModels.has(model)) {
        await new Promise((r) => setTimeout(r, 30));
        skippedMs += downMs;
        throw new Error(`[503 ] Deadline expired (${model})`);
      }
      if (!onDevice && model && garbageModels.has(model)) return { response: { inferenceSource: 'in_cloud', text: () => 'Sorry, I cannot help.' } };
      const body = onDevice ? deviceAnswer : cloudAnswer;
      return { response: { inferenceSource: onDevice ? 'on_device' : 'in_cloud', text: () => JSON.stringify(body) } };
    },
  }),
}));

const { cloudCallsToday, currencyCode, finishWords, readReceipt, readWords, readQuestion, PHOTO_TIMEOUT_MS } = await import('./hybrid');

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
});
let online = true;
vi.stubGlobal('navigator', {
  get onLine() {
    return online;
  },
});
// Gemini Nano reads English and French here, as Chrome 157 did in our tests; Kiswahili it does not.
vi.stubGlobal('LanguageModel', {
  availability: async (o?: { expectedInputs?: { type?: string; languages?: string[] }[] }) => {
    if (!nanoPhotos && o?.expectedInputs?.some((i) => i.type === 'image')) return 'unavailable';
    const langs = o?.expectedInputs?.flatMap((i) => i.languages ?? []) ?? ['en'];
    return langs.every((l) => l === 'en' || l === 'fr') ? 'available' : 'unavailable';
  },
});
// A photo turned into a JPEG needs a canvas, which the tests do not have.
vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10 }));
vi.stubGlobal('document', {
  createElement: () => ({ getContext: () => ({ drawImage: () => undefined }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }),
});
vi.stubGlobal('LanguageDetector', {
  availability: async () => 'available',
  create: async () => ({
    detect: async (t: string) => [{ detectedLanguage: /Nimemuuzia|atalipa|anadaiwa/.test(t) ? 'sw' : 'en', confidence: 0.99 }],
  }),
});

const ctx = {
  settings: { cloudModel: 'cloud-model', secondOpinionModel: 'second-model', secondOpinion: true, maxCloudCallsPerDay: 60 },
  shopCurrency: 'ZAR',
  knownNames: ['Thandi'],
};

const maize = (unit: number) => ({
  kind: 'sale',
  items: [{ name: 'maize meal', quantity: 2, unit_price: unit, line_total: 2 * unit }],
  total: 2 * unit,
  currency: 'ZAR',
  person: '',
  due: '',
});

beforeEach(() => {
  calls.length = 0;
  downModels.clear();
  garbageModels.clear();
  store.clear();
  online = true;
  downMs = 0;
  nanoPhotos = true;
});

describe('reading words', () => {
  it('keeps a reading that passes every check on the device, with no cloud call', async () => {
    deviceAnswer = maize(120);
    const e = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(e.status).toBe('checked');
    expect(e.reading.total).toBe(240);
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(e.hops.map((h) => h.where)).toEqual(['device']);
  });

  it('asks the cloud for a second opinion when a check fails, with the customer name taken out', async () => {
    deviceAnswer = {
      kind: 'sale',
      items: [{ name: 'loaves', quantity: 3, unit_price: 5, line_total: 15 }],
      total: 15,
      currency: 'ZAR',
      person: 'Thandi',
      due: 'Friday',
    };
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'loaves', quantity: 3, unit_price: 15, line_total: 45 }],
      total: 45,
      currency: 'ZAR',
      person: '[PERSON_1]',
      due: 'Friday',
    };
    const e = await readWords('Sold 3 loaves at R15 each to Thandi, she pays Friday', ctx);
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud']);
    const sent = calls[1].prompt;
    expect(sent).not.toMatch(/Thandi/i);
    expect(sent).toContain('[PERSON_1]');
    expect(sent).toMatch(/failed these checks/);
    expect(e.status).toBe('checked-in-cloud');
    expect(e.reading.person).toBe('Thandi');
    expect(e.reading.total).toBe(45);
    expect(e.firstReading?.total).toBe(15);
    expect(e.hops.map((h) => `${h.step}:${h.where}`)).toEqual(['read:device', 'second-opinion:cloud']);
    expect(e.hops[1].sent).toBe('the words, with 1 name removed');
  });

  it('sends an entry about a customer whose name is also an example in the instructions', () => {
    // The fixed prompt mentions "Sipho" in its examples; that must not stop an entry about a real Sipho.
    return (async () => {
      deviceAnswer = maize(60);
      cloudAnswer = maize(120);
      const e = await readWords('Sold two bags of maize meal for 120 rand each to Sipho', ctx);
      expect(calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud']);
      expect(calls[1].prompt).toContain('to [PERSON_1]');
      expect(e.status).toBe('checked-in-cloud');
    })();
  });

  it("takes names out of the device's problem lines too", async () => {
    // The device put the customer's name into an item name; the failed check quotes it.
    deviceAnswer = {
      kind: 'debt',
      items: [{ name: 'loaves for Thandi', quantity: 0, unit_price: 15, line_total: 0 }],
      total: 0,
      currency: 'ZAR',
      person: 'Thandi',
      due: 'Friday',
    };
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'loaves', quantity: 3, unit_price: 15, line_total: 45 }],
      total: 45,
      currency: 'ZAR',
      person: '[PERSON_1]',
      due: 'Friday',
    };
    const e = await readWords('Sold 3 loaves at R15 each to Thandi, she pays Friday', ctx);
    expect(calls[1].prompt).toMatch(/loaves for \[PERSON_1\]/);
    expect(calls[1].prompt).not.toMatch(/Thandi/i);
    expect(e.reading.person).toBe('Thandi');
  });

  it('does not take a capitalised item name in a problem line for a person', async () => {
    deviceAnswer = {
      kind: 'debt',
      items: [{ name: 'Loaves', quantity: 0, unit_price: 15, line_total: 0 }],
      total: 0,
      currency: 'ZAR',
      person: 'Thandi',
      due: 'Friday',
    };
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'loaves', quantity: 3, unit_price: 15, line_total: 45 }],
      total: 45,
      currency: 'ZAR',
      person: '[PERSON_1]',
      due: 'Friday',
    };
    const e = await readWords('Sold 3 loaves at R15 each to Thandi, she pays Friday', ctx);
    const sent = calls[1].prompt;
    expect(sent).toContain('Sold 3 loaves at R15 each to [PERSON_1], she pays Friday');
    expect(sent).toContain('"Loaves" has a quantity of 0');
    expect(sent).not.toContain('[PERSON_2]');
    expect(e.hops[1].sent).toBe('the words, with 1 name removed');
    expect(e.status).toBe('checked-in-cloud');
  });

  it('keeps a failed reading on the device while offline, then checks it when the connection is back', async () => {
    deviceAnswer = maize(60);
    online = false;
    const waiting = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(waiting.status).toBe('waiting');
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(waiting.problems.join(' ')).toMatch(/offline/);

    online = true;
    cloudAnswer = maize(120);
    const done = await finishWords({ ...waiting, hops: [...waiting.hops] }, ctx);
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device', 'only_in_cloud']);
    expect(done.status).toBe('checked-in-cloud');
    expect(done.reading.total).toBe(240);
  });

  it('sends a language Gemini Nano does not read straight to the cloud, names removed', async () => {
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'mikate', quantity: 2, unit_price: 60, line_total: 120 }],
      total: 120,
      currency: 'KES',
      person: '[PERSON_1]',
      due: 'Ijumaa',
    };
    const e = await readWords('Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa', ctx);
    expect(calls.map((c) => c.mode)).toEqual(['only_in_cloud']);
    expect(calls[0].prompt).not.toContain('Juma');
    expect(e.language).toBe('sw');
    expect(e.status).toBe('checked');
    expect(e.reading.person).toBe('Juma');
  });

  it('asks the cloud model once when the second-opinion model does not answer, and says so', async () => {
    deviceAnswer = maize(60);
    cloudAnswer = maize(120);
    downModels.add('second-model');
    const e = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(calls.map((c) => `${c.mode}:${c.model}`)).toEqual([
      'only_on_device:cloud-model',
      'only_in_cloud:second-model',
      'only_in_cloud:cloud-model',
    ]);
    expect(e.status).toBe('checked-in-cloud');
    expect(e.reading.total).toBe(240);
    expect(e.hops[1].model).toBe('cloud-model');
    expect(e.hops[1].reason).toMatch(/second-model did not answer, so cloud-model was asked/);
    expect(calls[2].prompt).toBe(calls[1].prompt);
    // The step shows the wait for both calls, not only the one that answered.
    expect(e.hops[1].ms).toBeGreaterThanOrEqual(25);
  });

  it('does not ask a fallback model past the daily cap', async () => {
    deviceAnswer = maize(60);
    cloudAnswer = maize(120);
    garbageModels.add('second-model');
    const capped = { ...ctx, settings: { ...ctx.settings, maxCloudCallsPerDay: 1 } };
    const e = await readWords('Sold two bags of maize meal for 120 rand each', capped);
    expect(calls.filter((c) => c.mode === 'only_in_cloud').map((c) => c.model)).toEqual(['second-model']);
    expect(e.status).toBe('waiting');
  });

  it('marks a reading that still holds a placeholder as needing the owner, not checked', async () => {
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'mikate', quantity: 2, unit_price: 60, line_total: 120 }],
      total: 120,
      currency: 'KES',
      person: '[PERSON_3]',
      due: 'Ijumaa',
    };
    const e = await readWords('Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa', ctx);
    expect(e.status).toBe('needs-you');
    expect(e.problems.join(' ')).toMatch(/PERSON_3/);
  });

  it('keeps the entry waiting when neither cloud model answers, and counts both calls against the daily cap', async () => {
    deviceAnswer = maize(60);
    downModels.add('second-model').add('cloud-model');
    const e = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(e.status).toBe('waiting');
    expect(e.problems.join(' ')).toMatch(/could not be reached/);
    expect(calls.filter((c) => c.mode === 'only_in_cloud')).toHaveLength(2);
    // A call that fails has still used the free quota, so the cap stops the loop over waiting entries.
    expect(cloudCallsToday()).toBe(2);
  });

  it('gives the fallback only what is left of 90 seconds, and never less than 30', async () => {
    deviceAnswer = maize(60);
    cloudAnswer = maize(120);
    downModels.add('second-model');
    await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(calls[1].timeout).toBe(60_000);
    expect(calls[2].timeout).toBeLessThanOrEqual(90_000 - 25);
    expect(calls[2].timeout).toBeGreaterThan(80_000);
    calls.length = 0;
    downMs = 60_000;
    await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(calls[2].model).toBe('cloud-model');
    expect(calls[2].timeout).toBe(30_000);
  });

  it('checks a device reading that writes the currency as "dollars", as the prompt says, with no cloud call', async () => {
    deviceAnswer = {
      kind: 'sale',
      items: [{ name: 'loaves', quantity: 2, unit_price: 3, line_total: 6 }],
      total: 6,
      currency: 'dollars',
      person: '',
      due: '',
    };
    const e = await readWords('Sold 2 loaves for 3 dollars each', ctx);
    expect(e.reading.currency).toBe('USD');
    expect(e.status).toBe('checked');
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
  });

  it('puts the phone number back when the cloud writes its placeholder as "Phone 1"', async () => {
    cloudAnswer = {
      kind: 'sale',
      items: [{ name: 'airtime', quantity: 1, unit_price: 20, line_total: 20 }],
      total: 20,
      currency: 'ZAR',
      person: 'Phone 1',
      due: '',
    };
    const e = await readWords('Nimemuuzia airtime ya R20 kwa 0772123456', { ...ctx, knownNames: [] });
    expect(e.reading.person).toBe('0772123456');
  });

  it('keeps a phone number the owner wrote after the word "phone" and checks the entry', async () => {
    cloudAnswer = {
      kind: 'sale',
      items: [{ name: 'airtime for phone [PHONE_1]', quantity: 1, unit_price: 20, line_total: 20 }],
      total: 20,
      currency: 'ZAR',
      person: '',
      due: '',
    };
    const e = await readWords('Nimemuuzia airtime ya R20 kwa phone 0772123456', { ...ctx, knownNames: [] });
    expect(e.reading.items[0].name).toBe('airtime for phone 0772123456');
    expect(e.problems.join(' ')).not.toMatch(/still holds/);
  });

  it('asks the second-opinion model when the cloud model does not answer a plain cloud read, the first with a 60-second limit', async () => {
    downModels.add('cloud-model');
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'mikate', quantity: 2, unit_price: 60, line_total: 120 }],
      total: 120,
      currency: 'KES',
      person: '[PERSON_1]',
      due: 'Ijumaa',
    };
    const e = await readWords('Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa', ctx);
    expect(calls.map((c) => `${c.mode}:${c.model}`)).toEqual(['only_in_cloud:cloud-model', 'only_in_cloud:second-model']);
    expect(e.status).toBe('checked');
    expect(e.hops[0].reason).toMatch(/cloud-model did not answer, so second-model was asked/);
    expect(calls[0].timeout).toBe(60_000);
    expect(calls[1].timeout).toBeLessThanOrEqual(90_000);
    expect(PHOTO_TIMEOUT_MS).toBe(120_000);
  });

  it('puts the name back when the cloud answers PERSON_1 without brackets', async () => {
    cloudAnswer = {
      kind: 'debt',
      items: [{ name: 'mikate', quantity: 2, unit_price: 60, line_total: 120 }],
      total: 120,
      currency: 'KES',
      person: 'PERSON_1',
      due: 'Ijumaa',
    };
    const e = await readWords('Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa', ctx);
    expect(e.reading.person).toBe('Juma');
    expect(e.status).toBe('checked');
  });

  it("reads the model's currency name or symbol as the words' code, so FCFA read as CFA passes", async () => {
    expect(currencyCode('CFA', 'ZAR')).toBe('XOF');
    expect(currencyCode('FCFA', 'ZAR')).toBe('XOF');
    expect(currencyCode('F CFA', 'ZAR')).toBe('XOF');
    expect(currencyCode('KSh', 'ZAR')).toBe('KES');
    expect(currencyCode('R', 'KES')).toBe('ZAR');
    expect(currencyCode('Rs', 'ZAR')).toBe('INR');
    expect(currencyCode('kes', 'ZAR')).toBe('KES');
    expect(currencyCode('TZS', 'ZAR')).toBe('TZS');
    expect(currencyCode('$', 'ZAR')).toBe('USD');
    expect(currencyCode('Z$', 'ZAR')).toBe('Z$');
    expect(currencyCode('A$', 'ZAR')).toBe('A$');
    expect(currencyCode('Kshs', 'ZAR')).toBe('KES');
    expect(currencyCode('TSh', 'ZAR')).toBe('TZS');
    expect(currencyCode('USh', 'ZAR')).toBe('UGX');
    expect(currencyCode('TSH', 'ZAR')).toBe('TZS');
    expect(currencyCode('TShs', 'ZAR')).toBe('TZS');
    expect(currencyCode('USH', 'ZAR')).toBe('UGX');
    expect(currencyCode('UShs', 'ZAR')).toBe('UGX');
    // Round 13 (EBE-11444): a name the list does not hold is kept whole, so it fails the code check.
    expect(currencyCode('Australian dollars', 'ZAR')).toBe('AUSTRALIAN DOLLARS');
    expect(currencyCode('Botswana pula', 'ZAR')).toBe('BOTSWANA PULA');
    // Round 14: a country's name with or without its -n, and a code with a gloss after it.
    expect(currencyCode('Tanzania shillings', 'ZAR')).toBe('TZS');
    expect(currencyCode('Uganda shillings', 'ZAR')).toBe('UGX');
    expect(currencyCode('Kenya shillings', 'ZAR')).toBe('KES');
    expect(currencyCode('USD (US dollars)', 'ZAR')).toBe('USD');
    expect(currencyCode('ZAR - rand', 'KES')).toBe('ZAR');
    // The names the read prompt itself gives, and a country's name for its own currency.
    expect(currencyCode('dollars', 'ZAR')).toBe('USD');
    expect(currencyCode('US dollars', 'ZAR')).toBe('USD');
    expect(currencyCode('shillings', 'ZAR')).toBe('KES');
    expect(currencyCode('Kenyan shillings', 'ZAR')).toBe('KES');
    expect(currencyCode('CFA francs', 'ZAR')).toBe('XOF');
    expect(currencyCode('francs CFA', 'ZAR')).toBe('XOF');
    expect(currencyCode('GH₵', 'ZAR')).toBe('GHS');
    expect(currencyCode('Tanzanian shillings', 'ZAR')).toBe('TZS');
    expect(currencyCode('Ugandan shillings', 'ZAR')).toBe('UGX');
    // Another country's dollar is not read as US dollars: it is left to fail the currency check.
    expect(currencyCode('Australian dollars', 'ZAR')).not.toBe('USD');
    expect(currencyCode('Namibian dollars', 'ZAR')).not.toBe('USD');
    expect(currencyCode(null, 'ZAR')).toBe('ZAR');
    deviceAnswer = {
      kind: 'debt',
      items: [{ name: 'sacs de riz', quantity: 2, unit_price: 5000, line_total: 10000 }],
      total: 10000,
      currency: 'CFA',
      person: 'Awa',
      due: 'samedi',
    };
    const e = await readWords('Vendu 2 sacs de riz à 5000 FCFA chacun à Awa, elle paie samedi', { ...ctx, knownNames: [] });
    expect(e.reading.currency).toBe('XOF');
    expect(e.status).toBe('checked');
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
  });

  it('marks an entry that fails the second opinion too as needing the owner', async () => {
    deviceAnswer = maize(60);
    cloudAnswer = maize(50);
    const e = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(e.status).toBe('needs-you');
  });

  it('stops at the daily cloud cap', async () => {
    deviceAnswer = maize(60);
    const capped = { ...ctx, settings: { ...ctx.settings, maxCloudCallsPerDay: 0 } };
    const e = await readWords('Sold two bags of maize meal for 120 rand each', capped);
    expect(e.status).toBe('waiting');
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
  });
});

describe('receipts', () => {
  const receipt = {
    kind: 'purchase',
    items: [{ name: 'flour', quantity: 2, unit_price: 100, line_total: 200 }],
    total: 200,
    currency: 'ZAR',
    person: '',
    due: '',
  };

  it('asks the other cloud model when a device without Gemini Nano gets nothing from the cloud model', async () => {
    nanoPhotos = false;
    downModels.add('cloud-model');
    cloudAnswer = receipt;
    const e = await readReceipt(new Blob(['x']), ctx);
    expect(calls.map((c) => `${c.mode}:${c.model}`)).toEqual(['prefer_on_device:cloud-model', 'only_in_cloud:second-model']);
    expect(e.status).toBe('checked');
    expect(e.hops.at(-1)?.reason).toMatch(/cloud-model could not read the photo/);
    expect(cloudCallsToday()).toBe(2);
  });

  it('keeps the photo retry after a cloud first pass inside 180 seconds', async () => {
    nanoPhotos = false;
    downModels.add('cloud-model');
    cloudAnswer = receipt;
    downMs = 120_000;
    await readReceipt(new Blob(['x']), ctx);
    expect(calls.map((c) => c.timeout)).toEqual([120_000, 60_000]);
    calls.length = 0;
    downMs = 0;
    await readReceipt(new Blob(['x']), ctx);
    expect(calls[0].timeout).toBe(120_000);
    expect(calls[1].timeout).toBeLessThanOrEqual(180_000 - 25);
    expect(calls[1].timeout).toBeGreaterThan(170_000);
  });
});

describe('questions', () => {
  it('refuses a cloud reading of a question that still holds a placeholder', async () => {
    cloudAnswer = { intent: 'owed_by', person: 'PERSON_2', item: '', period: 'all' };
    await expect(readQuestion('Juma anadaiwa kiasi gani?', ctx)).rejects.toThrow(/PERSON_2/);
  });

  it('turns a question into a query on the device and sends no record anywhere', async () => {
    deviceAnswer = { intent: 'owed_by', person: 'Thandi', item: '', period: 'all' };
    const { query, hops } = await readQuestion('How much does Thandi owe?', ctx);
    expect(query).toEqual({ intent: 'owed_by', person: 'Thandi', item: null, period: 'all' });
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(hops[0].sent).toBe('');
  });
});

describe('round 14 prompt (EBE-11444)', () => {
  it("names Tanzanian and Ugandan shillings in the read prompt, as the device's currency check reads them", async () => {
    const { readPrompt } = await import('./prompts');
    const p = readPrompt('Sold 2 sodas for 1500 Tanzanian shillings', 'ZAR');
    expect(p).toMatch(/Tanzanian shillings is TZS/);
    expect(p).toMatch(/Ugandan shillings is UGX/);
  });
});
