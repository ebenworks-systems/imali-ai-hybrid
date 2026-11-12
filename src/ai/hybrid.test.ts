// The routing between Gemini Nano and the cloud, with the Firebase SDK and Chrome's built-in AI replaced by stubs.
// Each stub call is recorded, so the tests can see which engine ran and exactly what text left the device.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  mode: string;
  prompt: string;
}
const calls: Call[] = [];
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
  getGenerativeModel: (_ai: unknown, params: { mode: string }) => ({
    initializeDeviceModel: async () => undefined,
    generateContent: async (parts: { text?: string }[]) => {
      const prompt = parts.map((p) => p.text ?? '').join('\n');
      calls.push({ mode: params.mode, prompt });
      const onDevice = params.mode === 'only_on_device' || params.mode === 'prefer_on_device';
      const body = onDevice ? deviceAnswer : cloudAnswer;
      return { response: { inferenceSource: onDevice ? 'on_device' : 'in_cloud', text: () => JSON.stringify(body) } };
    },
  }),
}));

const { finishWords, readWords, readQuestion } = await import('./hybrid');

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
    detect: async (t: string) => [{ detectedLanguage: /Nimemuuzia|atalipa/.test(t) ? 'sw' : 'en', confidence: 0.99 }],
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
  it('turns a question into a query on the device and sends no record anywhere', async () => {
    deviceAnswer = { intent: 'owed_by', person: 'Thandi', item: '', period: 'all' };
    const { query, hops } = await readQuestion('How much does Thandi owe?', ctx);
    expect(query).toEqual({ intent: 'owed_by', person: 'Thandi', item: null, period: 'all' });
    expect(calls.map((c) => c.mode)).toEqual(['only_on_device']);
    expect(hops[0].sent).toBe('');
  });
});
