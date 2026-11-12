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
      const onDevice = params.mode === 'only_on_device' || params.mode === 'prefer_on_device';
      if (!onDevice && model && downModels.has(model)) {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error(`[503 ] Deadline expired (${model})`);
      }
      if (!onDevice && model && garbageModels.has(model)) return { response: { inferenceSource: 'in_cloud', text: () => 'Sorry, I cannot help.' } };
      const body = onDevice ? deviceAnswer : cloudAnswer;
      return { response: { inferenceSource: onDevice ? 'on_device' : 'in_cloud', text: () => JSON.stringify(body) } };
    },
  }),
}));

const { currencyCode, finishWords, readWords, readQuestion, PHOTO_TIMEOUT_MS } = await import('./hybrid');

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
  availability: async (o?: { expectedInputs?: { languages?: string[] }[] }) => {
    const langs = o?.expectedInputs?.flatMap((i) => i.languages ?? []) ?? ['en'];
    return langs.every((l) => l === 'en' || l === 'fr') ? 'available' : 'unavailable';
  },
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

  it('keeps the entry waiting when neither cloud model answers, and counts no cloud call', async () => {
    deviceAnswer = maize(60);
    downModels.add('second-model').add('cloud-model');
    const e = await readWords('Sold two bags of maize meal for 120 rand each', ctx);
    expect(e.status).toBe('waiting');
    expect(e.problems.join(' ')).toMatch(/could not be reached/);
    expect(calls.filter((c) => c.mode === 'only_in_cloud')).toHaveLength(2);
    expect(store.size).toBe(0);
  });

  it('asks the second-opinion model when the cloud model does not answer a plain cloud read, each with a 60-second limit', async () => {
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
    expect(calls.every((c) => c.timeout === 60_000)).toBe(true);
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
