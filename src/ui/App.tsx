// The one screen of the Imali AI book: tell it a sale, show it a receipt, ask it a question. Everything the owner
// enters stays in this browser. The ledger shows every step that ran in the cloud and what it was sent.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cloudConfigured, DEFAULTS, loadSettings, type Settings } from '../ai/firebase';
import {
  cloudBlocked,
  cloudCallsToday,
  DEVICE_MODEL,
  deviceStatus,
  finishWords,
  languageName,
  prepareDevice,
  readQuestion,
  readReceipt,
  readWords,
  type Context,
} from '../ai/hybrid';
import { allEntries, clearBook, deleteEntry, getEntry, getMeta, saveEntry, setMeta } from '../book/db';
import { answer, fmt, type Answer } from '../book/query';
import type { Entry, Hop, Kind, Query, Reading, Status } from '../book/types';
import { checkReceipt, checkWords } from '../check/checks';

type DeviceState = Awaited<ReturnType<typeof deviceStatus>> | 'checking';
type Tab = 'words' | 'receipt' | 'ask';
type Slip =
  | { type: 'entry'; entry: Entry }
  | { type: 'answer'; question: string; query: Query; answer: Answer; hops: Hop[] };
interface AskLog {
  device: number;
  cloud: number;
  names: number;
}

const CURRENCIES: [string, string][] = [
  ['ZAR', 'Rand (R)'],
  ['KES', 'Kenyan shilling (KSh)'],
  ['USD', 'US dollar (US$)'],
  ['XOF', 'CFA franc (CFA)'],
  ['INR', 'Rupee (₹)'],
  ['NGN', 'Naira (₦)'],
  ['GHS', 'Cedi (GH₵)'],
  ['ZWG', 'ZiG'],
  ['EUR', 'Euro (€)'],
];

const WORD_EXAMPLES: { text: string; tag: string }[] = [
  { text: 'Sold 3 loaves at R15 each to Thandi, she pays Friday', tag: 'on credit' },
  { text: 'Thandi paid R30', tag: 'paid back' },
  { text: 'Paid R200 for the electricity token', tag: 'expense' },
  { text: 'Sold two bags of maize meal for 120 rand each', tag: 'price each' },
  { text: 'Nimemuuzia Juma mikate 2 kwa KSh 60 kila mmoja, atalipa Ijumaa', tag: 'Kiswahili' },
  { text: 'Vendu 2 sacs de riz à 5000 FCFA chacun à Awa, elle paie samedi', tag: 'French' },
];

const QUESTION_EXAMPLES = ['How much does Thandi owe?', 'Who owes me money?', 'What did I sell today?', 'Did I make money this week?'];

const KIND_LABEL: Record<Kind, string> = {
  sale: 'Sale',
  debt: 'On credit',
  payment: 'Paid back',
  expense: 'Expense',
  purchase: 'Stock bought',
};

const STATUS_LABEL: Record<Status, string> = {
  checked: 'Checked',
  'checked-in-cloud': 'Fixed by a second opinion',
  waiting: 'Waiting for a check',
  'needs-you': 'Needs you',
};

const STEP_LABEL: Record<Hop['step'], string> = {
  read: 'Read',
  'second-opinion': 'Second opinion',
  ask: 'Question',
  receipt: 'Receipt',
  voice: 'Voice note',
};

const ICON = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  tick: 'M5 12.5l4.5 4.5L19 7.5',
  cross: 'M7 7l10 10M17 7L7 17',
  device: 'M4 5h16v11H4zM2 19.5h20',
  cloud: 'M7.5 18.5h9.5a4 4 0 00.5-7.97A6 6 0 006.3 9.4a4.6 4.6 0 001.2 9.1z',
  camera: 'M4 8.5h3.2L9 6h6l1.8 2.5H20V19H4zM12 16.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z',
  bin: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7',
  note: 'M12 8v5M12 16.5v.5M12 3.5l9 16H3z',
};

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const namesIn = (h: Hop) => {
  const m = /(\d+) names? removed/.exec(h.sent);
  return m ? Number(m[1]) : 0;
};

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function entryTitle(e: Entry): string {
  if (e.source !== 'receipt') return e.words;
  const n = e.reading.items.length;
  const from = e.reading.person ? ` from ${e.reading.person}` : '';
  return `Receipt${from}: ${n} ${n === 1 ? 'line' : 'lines'}`;
}

const lineSum = (r: Reading) => r.items.map((l) => `${l.quantity} x ${l.unit_price} = ${l.line_total}`).join('; ');

// ---- parts of the screen --------------------------------------------------------------------------------------------

function Hops({ hops }: { hops: Hop[] }) {
  if (!hops.length) return null;
  return (
    <>
      <p className="label" style={{ marginTop: 22 }}>
        Where it ran
      </p>
      <ol className="hops">
        {hops.map((h, i) => (
          <li className="hop" key={i}>
            <span className={`where ${h.where}`}>
              <Icon d={h.where === 'device' ? ICON.device : ICON.cloud} size={15} />
              {h.where === 'device' ? 'This device' : 'Cloud'}
            </span>
            <time>{seconds(h.ms)}</time>
            <p>
              <b>
                {STEP_LABEL[h.step]} by {h.model}
              </b>
              : {h.reason}.{h.sent ? ` Sent: ${h.sent}.` : ' Nothing left this device.'}
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}

function EntrySlip({ entry, onRemove }: { entry: Entry; onRemove: (id: string) => void }) {
  const r = entry.reading;
  const check = entry.source === 'receipt' ? checkReceipt(r) : checkWords(r, entry.words);
  const showPassed = entry.status === 'checked' || entry.status === 'checked-in-cloud';
  return (
    <div className="slip reveal" key={entry.id}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
        <span className={`status ${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
      </div>
      {entry.source !== 'receipt' && <p className="said">{entry.words}</p>}
      {r.items.length > 0 && (
        <>
          <table className="lines">
            <tbody>
              {r.items.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.name}
                    <small>
                      {l.quantity} x {fmt(l.unit_price, r.currency)}
                    </small>
                  </td>
                  <td>{fmt(l.line_total, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="total">
            <span className="label">Total</span>
            <b>{fmt(r.total, r.currency)}</b>
          </div>
        </>
      )}
      {(r.person || r.due) && (
        <div className="who">
          {r.person && (
            <span>
              {r.kind === 'purchase' || r.kind === 'expense' ? 'Supplier' : 'Customer'}: <b>{r.person}</b>
            </span>
          )}
          {r.due && (
            <span>
              Pays: <b>{r.due}</b>
            </span>
          )}
          {entry.language !== 'en' && <span>Language: {languageName(entry.language)}</span>}
        </div>
      )}
      {entry.firstReading && (
        <p className="was">
          {DEVICE_MODEL} first read <s>{lineSum(entry.firstReading)}</s>. A check caught it, and the second opinion's reading passed every
          check.
        </p>
      )}
      <ul className="checks">
        {showPassed &&
          check.passed.map((p) => (
            <li key={p}>
              <Icon d={ICON.tick} size={16} />
              {p}
            </li>
          ))}
        {entry.problems.map((p) => (
          <li key={p} className={entry.status === 'waiting' ? 'wait' : 'bad'}>
            <Icon d={entry.status === 'waiting' ? ICON.note : ICON.cross} size={16} />
            {p}
          </li>
        ))}
      </ul>
      {entry.status === 'needs-you' && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="hint">This is not in your totals. Say it again in other words, or remove it.</span>
          <button className="ghost" type="button" onClick={() => onRemove(entry.id)}>
            Remove
          </button>
        </div>
      )}
      <Hops hops={entry.hops} />
    </div>
  );
}

function AnswerSlip({ slip, currency }: { slip: Extract<Slip, { type: 'answer' }>; currency: string }) {
  return (
    <div className="reveal">
      <p className="said">{slip.question}</p>
      <div className="answer">
        <b>{slip.answer.text}</b>
        {slip.answer.rows.length > 0 && (
          <ul>
            {slip.answer.rows.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <span>{fmt(row.value, row.currency ?? currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="note">The model only worked out what you asked. The figures were added up by plain code from the book in this browser, and no record was sent anywhere.</p>
      <Hops hops={slip.hops} />
    </div>
  );
}

// ---- the app ----------------------------------------------------------------------------------------------------------

export function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [currency, setCurrency] = useState('ZAR');
  const [secondOn, setSecondOn] = useState(true);
  const [askLog, setAskLog] = useState<AskLog>({ device: 0, cloud: 0, names: 0 });
  const [device, setDevice] = useState<DeviceState>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [tab, setTab] = useState<Tab>('words');
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [photo, setPhoto] = useState<{ file: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [callsToday, setCallsToday] = useState(0);
  const [removed, setRemoved] = useState<Entry | null>(null);
  const retrying = useRef(false);
  /** Set while a read or a question runs, so a second Enter in the textarea cannot save the same entry twice. */
  const working = useRef(false);
  /** Set when the connection came back during a read; the waiting entries are checked as soon as it ends. */
  const retryAfter = useRef(false);

  const refresh = useCallback(async () => {
    setEntries(await allEntries());
    setCallsToday(cloudCallsToday());
  }, []);

  useEffect(() => {
    void (async () => {
      setCurrency(await getMeta('currency', 'ZAR'));
      setSecondOn(await getMeta('secondOpinion', true));
      setAskLog(await getMeta('askLog', { device: 0, cloud: 0, names: 0 }));
      await refresh();
      setDevice(await deviceStatus());
      setSettings(await loadSettings());
    })();
  }, [refresh]);

  const knownNames = useMemo(
    () => [...new Set(entries.map((e) => e.reading.person).filter((p): p is string => Boolean(p)))],
    [entries],
  );

  const ctx = useMemo<Context>(
    () => ({
      settings: { ...settings, secondOpinion: settings.secondOpinion && secondOn },
      shopCurrency: currency,
      knownNames,
      onStep: setBusy,
    }),
    [settings, secondOn, currency, knownNames],
  );
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  /** Entries kept on the device while the cloud was out of reach get their check as soon as it can be asked. */
  const checkWaiting = useCallback(async () => {
    const c = ctxRef.current;
    if (working.current) {
      retryAfter.current = true;
      return;
    }
    if (retrying.current || cloudBlocked(c)) return;
    retrying.current = true;
    try {
      const waiting = (await allEntries()).filter((e) => e.status === 'waiting' && e.source === 'words').reverse();
      for (const [i, e] of waiting.entries()) {
        setBusy(`Checking ${i + 1} of ${waiting.length} entries that waited`);
        const done = await finishWords({ ...e, hops: [...e.hops] }, { ...c, onStep: undefined });
        // The owner may have removed the entry or cleared the book while the cloud was answering.
        if (await getEntry(e.id)) await saveEntry(done);
        if (cloudBlocked(c)) break;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      retrying.current = false;
      setBusy(null);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void checkWaiting();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [checkWaiting]);

  const run = async (work: () => Promise<void>) => {
    if (working.current || retrying.current) return;
    working.current = true;
    setError(null);
    setBusy('Starting');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      working.current = false;
      setBusy(null);
      await refresh();
      if (retryAfter.current) {
        retryAfter.current = false;
        void checkWaiting();
      }
    }
  };

  const addWords = (words: string) =>
    run(async () => {
      setRemoved(null);
      const w = words.trim();
      if (!w) return;
      const entry = await readWords(w, ctx);
      await saveEntry(entry);
      setSlip({ type: 'entry', entry });
      setText('');
    });

  const addReceipt = () =>
    run(async () => {
      if (!photo) return;
      const entry = await readReceipt(photo.file, ctx);
      await saveEntry(entry);
      setSlip({ type: 'entry', entry });
    });

  const ask = (q: string) =>
    run(async () => {
      const asked = q.trim();
      if (!asked) return;
      const { query, hops } = await readQuestion(asked, ctx);
      const book = await allEntries();
      setSlip({ type: 'answer', question: asked, query, answer: answer(query, book, currency), hops });
      const log = {
        device: askLog.device + hops.filter((h) => h.where === 'device').length,
        cloud: askLog.cloud + hops.filter((h) => h.where === 'cloud').length,
        names: askLog.names + hops.reduce((s, h) => s + namesIn(h), 0),
      };
      setAskLog(log);
      await setMeta('askLog', log);
    });

  const pickPhoto = (f: Blob | null | undefined) => {
    if (!f) return;
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({ file: f, url: URL.createObjectURL(f) });
  };

  const sampleReceipt = async () => {
    const res = await fetch('/samples/receipt-sunrise.jpg');
    pickPhoto(await res.blob());
  };

  const getNano = async () => {
    setError(null);
    setProgress(0);
    setDevice('downloading');
    try {
      await prepareDevice((p) => setProgress(p));
    } catch (e) {
      setError(`${DEVICE_MODEL} could not be set up here: ${(e as Error).message}`);
    }
    setProgress(null);
    setDevice(await deviceStatus());
  };

  const remove = async (id: string) => {
    setRemoved(entries.find((e) => e.id === id) ?? null);
    await deleteEntry(id);
    if (slip?.type === 'entry' && slip.entry.id === id) setSlip(null);
    await refresh();
  };

  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>, go: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      go();
    }
  };

  // ---- figures --------------------------------------------------------------------------------------------------------

  const fig = (intent: Query['intent'], period: Query['period']) =>
    answer({ intent, person: null, item: null, period }, entries, currency).figure ?? 0;
  const soldToday = fig('sales_total', 'today');
  const spentToday = fig('expenses_total', 'today');
  const owed = fig('who_owes', 'all');
  const otherCurrency = entries.filter((e) => e.reading.currency !== currency).length;
  const waiting = entries.filter((e) => e.status === 'waiting').length;

  const allHops = entries.flatMap((e) => e.hops);
  const deviceSteps = allHops.filter((h) => h.where === 'device').length + askLog.device;
  const cloudSteps = allHops.filter((h) => h.where === 'cloud').length + askLog.cloud;
  const namesOut = allHops.reduce((s, h) => s + namesIn(h), 0) + askLog.names;
  const stayed = entries.filter((e) => !e.hops.some((h) => h.where === 'cloud')).length;
  const blocked = cloudBlocked(ctx);
  const shown = showAll ? entries : entries.slice(0, 6);

  const deviceChip = (() => {
    switch (device) {
      case 'checking':
        return { cls: '', text: `Looking for ${DEVICE_MODEL}` };
      case 'available':
        return { cls: 'ok', text: `${DEVICE_MODEL} ready` };
      case 'downloadable':
        return { cls: 'warn', text: `${DEVICE_MODEL} not downloaded`, action: true };
      case 'downloading':
        return { cls: 'warn', text: `Downloading ${DEVICE_MODEL}${progress !== null ? ` ${Math.round(progress * 100)}%` : ''}` };
      case 'unavailable':
        return { cls: 'off', text: `No ${DEVICE_MODEL} on this device` };
      default:
        return { cls: 'off', text: 'No built-in AI in this browser' };
    }
  })();

  const cloudChip = !cloudConfigured
    ? { cls: 'off', text: 'Cloud not set up' }
    : !ctx.settings.secondOpinion
      ? { cls: 'warn', text: 'Second opinion off' }
      : { cls: 'ok', text: `${ctx.settings.secondOpinionModel} on call` };

  const deviceReady = device === 'available';

  return (
    <div className="page">
      <a className="skip" href="#composer-title">
        Skip to the book
      </a>
      <header className="top">
        <a className="brand" href="/" aria-label="Imali AI book, home" translate="no">
          <img src="/imali-logo.svg" alt="Imali AI" width={112} height={30} />
          <span>Counter book</span>
        </a>
        <div className="chips">
          <span className={`chip ${deviceChip.cls}`}>
            <i />
            {deviceChip.text}
            {deviceChip.action && (
              <button type="button" onClick={getNano}>
                Get it
              </button>
            )}
          </span>
          <span className={`chip ${online ? 'ok' : 'off'}`}>
            <i />
            {online ? 'Online' : 'Offline'}
          </span>
          <span className={`chip ${cloudChip.cls}`}>
            <i />
            {cloudChip.text}
          </span>
        </div>
      </header>

      <section className="intro">
        <div>
          <span className="eyebrow">Firebase AI Logic · hybrid inference</span>
          <h1>
            The shop book that reads <em>on this device.</em>
          </h1>
        </div>
        <p>
          Type a sale, show it a supplier's receipt or ask who owes you. {DEVICE_MODEL} reads it in Chrome, plain code checks every sum,
          and the cloud model is asked only when a check fails, with names taken out first.
        </p>
      </section>

      <main className="bento">
        <section className="shell span-7" aria-labelledby="composer-title">
          <div className="core">
            <h2 id="composer-title">Tell the book</h2>
            <p className="sub">
              {deviceReady
                ? `${DEVICE_MODEL} reads English, French and Spanish here, offline too. Other languages go to the cloud with names taken out.`
                : `Without ${DEVICE_MODEL} on this device, each reading goes to the cloud with names taken out.`}
            </p>
            <div className="tabs" role="tablist" aria-label="What to add">
              {(
                [
                  ['words', 'Tell it'],
                  ['receipt', 'Receipt photo'],
                  ['ask', 'Ask the book'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'words' && (
              <div role="tabpanel" id="panel-words" aria-labelledby="tab-words">
                <label className="sr" htmlFor="words">
                  What happened
                </label>
                <textarea
                  id="words"
                  name="words"
                  value={text}
                  placeholder="Sold 3 loaves at R15 each to Thandi, she pays Friday…"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => onEnter(e, () => void addWords(text))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="examples" aria-label="Examples">
                  {WORD_EXAMPLES.map((x) => (
                    <button key={x.text} type="button" disabled={Boolean(busy)} onClick={() => void addWords(x.text)}>
                      {x.text}
                      <small>{x.tag}</small>
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="go" type="button" disabled={Boolean(busy) || !text.trim()} onClick={() => void addWords(text)}>
                    Add to the book
                    <span className="knob">
                      <Icon d={ICON.arrow} />
                    </span>
                  </button>
                  {busy ? (
                    <span className="busy" role="status">
                      <i />
                      {busy}…
                    </span>
                  ) : (
                    <span className="hint">Enter adds it. Shift and Enter starts a new line.</span>
                  )}
                </div>
              </div>
            )}

            {tab === 'receipt' && (
              <div role="tabpanel" id="panel-receipt" aria-labelledby="tab-receipt">
                <label
                  className="drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    pickPhoto(e.dataTransfer.files[0]);
                  }}
                >
                  <input className="sr" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pickPhoto(e.target.files?.[0])} />
                  {photo ? (
                    <img src={photo.url} alt="The receipt you chose" />
                  ) : (
                    <>
                      <Icon d={ICON.camera} size={30} />
                      <strong>Choose or drop a receipt photo</strong>
                      <span className="hint">A supplier's receipt or invoice. {DEVICE_MODEL} reads it here when this device has it.</span>
                    </>
                  )}
                </label>
                <div className="row" style={{ marginTop: 18 }}>
                  <button className="go" type="button" disabled={Boolean(busy) || !photo} onClick={() => void addReceipt()}>
                    Read the receipt
                    <span className="knob">
                      <Icon d={ICON.arrow} />
                    </span>
                  </button>
                  <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void sampleReceipt()}>
                    Use a sample receipt
                  </button>
                  {busy && (
                    <span className="busy" role="status">
                      <i />
                      {busy}…
                    </span>
                  )}
                </div>
              </div>
            )}

            {tab === 'ask' && (
              <div role="tabpanel" id="panel-ask" aria-labelledby="tab-ask">
                <label className="sr" htmlFor="question">
                  Your question
                </label>
                <textarea
                  id="question"
                  name="question"
                  className="short"
                  value={question}
                  placeholder="How much does Thandi owe?"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => onEnter(e, () => void ask(question))}
                  autoComplete="off"
                />
                <div className="examples" aria-label="Example questions">
                  {QUESTION_EXAMPLES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setQuestion(q);
                        void ask(q);
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="go" type="button" disabled={Boolean(busy) || !question.trim()} onClick={() => void ask(question)}>
                    Ask
                    <span className="knob">
                      <Icon d={ICON.arrow} />
                    </span>
                  </button>
                  {busy ? (
                    <span className="busy" role="status">
                      <i />
                      {busy}…
                    </span>
                  ) : (
                    <span className="hint">The book itself never leaves this browser.</span>
                  )}
                </div>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>

        <section className="shell span-5" aria-labelledby="slip-title" aria-live="polite">
          <div className="core">
            <h2 id="slip-title">{slip?.type === 'answer' ? 'The answer' : 'The reading'}</h2>
            <p className="sub">What the model read, what the checks found and where each step ran.</p>
            {!slip && (
              <p className="empty">
                <b>Nothing read yet.</b> Pick an example or type a sale to see how it is read and checked.
              </p>
            )}
            {slip?.type === 'entry' && <EntrySlip entry={slip.entry} onRemove={(id) => void remove(id)} />}
            {slip?.type === 'answer' && <AnswerSlip slip={slip} currency={currency} />}
          </div>
        </section>

        <section className="shell span-7" aria-labelledby="book-title">
          <div className="core">
            <h2 id="book-title">The book</h2>
            <p className="sub">Only entries that passed every check count in these figures.</p>
            <div className="figures">
              <div className="figure">
                <span className="label">Sold today</span>
                <b>{fmt(soldToday, currency)}</b>
              </div>
              <div className="figure">
                <span className="label">Spent today</span>
                <b>{fmt(spentToday, currency)}</b>
              </div>
              <div className="figure owed">
                <span className="label">Owed to you</span>
                <b>{fmt(owed, currency)}</b>
              </div>
            </div>
            {entries.length === 0 ? (
              <p className="empty">The book is empty. Entries you add are kept in this browser and nowhere else.</p>
            ) : (
              <ul className="entries">
                {shown.map((e) => {
                  const out = e.reading.kind === 'expense' || e.reading.kind === 'purchase';
                  const usedCloud = e.hops.some((h) => h.where === 'cloud');
                  return (
                    <li className="entry" key={e.id}>
                      <button className="what" type="button" onClick={() => setSlip({ type: 'entry', entry: e })}>
                        {entryTitle(e)}
                      </button>
                      <span className={`amt${out ? ' out' : ''}`}>
                        {e.reading.items.length ? `${out ? '-' : ''}${fmt(e.reading.total, e.reading.currency)}` : <small className="unread">Not read yet</small>}
                      </span>
                      <span className="meta">
                        <span className={`status ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                        <span>{KIND_LABEL[e.reading.kind]}</span>
                        <span className="ran">
                          <Icon d={usedCloud ? ICON.cloud : ICON.device} size={14} />
                          {usedCloud ? 'Cloud helped' : 'This device'}
                        </span>
                        <span>
                          {dayLabel(e.createdAt)} {clock(e.createdAt)}
                        </span>
                      </span>
                      <button className="bin" type="button" aria-label={`Remove: ${entryTitle(e)}`} onClick={() => void remove(e.id)}>
                        <Icon d={ICON.bin} size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {removed && (
              <div className="undo" role="status">
                <span>Removed: {entryTitle(removed)}</span>
                <button
                  className="ghost"
                  type="button"
                  onClick={async () => {
                    await saveEntry(removed);
                    setRemoved(null);
                    await refresh();
                  }}
                >
                  Undo
                </button>
              </div>
            )}
            {entries.length > 6 && (
              <button className="ghost more" type="button" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show the latest six' : `Show all ${entries.length}`}
              </button>
            )}
            {otherCurrency > 0 && (
              <p className="note">
                {otherCurrency === 1 ? '1 entry is' : `${otherCurrency} entries are`} in another currency, so {otherCurrency === 1 ? 'it stays' : 'they stay'} in the
                book but out of these figures.
              </p>
            )}
          </div>
        </section>

        <section className="shell span-5" aria-labelledby="ledger-title">
          <div className="core">
            <h2 id="ledger-title">Where the work ran</h2>
            <p className="sub">Every model step, counted in this browser.</p>
            <div className="ledger">
              <div className="device">
                <span className="label">On this device</span>
                <b>{deviceSteps}</b>
              </div>
              <div className="cloud">
                <span className="label">In the cloud</span>
                <b>{cloudSteps}</b>
              </div>
            </div>
            <p className="note">
              {entries.length > 0
                ? `${stayed} of ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} never left this device. `
                : 'Nothing has been read yet. '}
              {namesOut === 1 ? '1 name was' : `${namesOut} names were`} taken out before a cloud call. Cloud calls today: {callsToday} of{' '}
              {settings.maxCloudCallsPerDay}.
            </p>
            {waiting > 0 && (
              <div className="queue">
                <span>
                  {waiting === 1 ? '1 entry waits' : `${waiting} entries wait`} for a check. {blocked ? `Not now: ${blocked}.` : 'The cloud can check now.'}
                </span>
                <button className="ghost" type="button" disabled={Boolean(blocked) || Boolean(busy)} onClick={() => void checkWaiting()}>
                  Check now
                </button>
              </div>
            )}
            <div className="settings">
              <label>
                Shop currency
                <select
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    void setMeta('currency', e.target.value);
                  }}
                >
                  {CURRENCIES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cloud second opinion when a check fails
                <input
                  className="toggle"
                  type="checkbox"
                  checked={secondOn}
                  onChange={(e) => {
                    setSecondOn(e.target.checked);
                    void setMeta('secondOpinion', e.target.checked);
                  }}
                />
              </label>
              <label>
                Start a fresh book
                <button
                  className="ghost"
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Clear every entry in this browser?')) return;
                    await clearBook();
                    setSlip(null);
                    await refresh();
                  }}
                >
                  Clear the book
                </button>
              </label>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>
          <b>Records you own.</b> This book is kept in this browser and nowhere else.
        </span>
        <span>Imali AI · hybrid build with Firebase AI Logic and {DEVICE_MODEL} in Chrome</span>
      </footer>
    </div>
  );
}
