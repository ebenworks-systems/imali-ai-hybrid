// The shapes every part of the app shares: what the model returns, what the book keeps, and where each step ran.

export type Kind = 'sale' | 'expense' | 'debt' | 'payment' | 'purchase';

export const KINDS: readonly Kind[] = ['sale', 'expense', 'debt', 'payment', 'purchase'];

export interface Line {
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** One reading of what happened, as a model returns it. */
export interface Reading {
  kind: Kind;
  items: Line[];
  total: number;
  currency: string;
  person: string | null;
  due: string | null;
}

/** Where a model call ran. */
export type Where = 'device' | 'cloud';

/** Why a step went to the cloud, or why it stayed on the device. */
export interface Hop {
  at: number; // epoch ms
  step: 'read' | 'second-opinion' | 'ask' | 'receipt' | 'voice';
  where: Where;
  model: string;
  ms: number;
  reason: string;
  /** What left the device on this hop, in plain words (empty for device hops). */
  sent: string;
}

export type Status = 'checked' | 'checked-in-cloud' | 'waiting' | 'needs-you';

export interface Entry {
  id: string;
  createdAt: number;
  source: 'words' | 'receipt' | 'voice';
  /** What the owner typed or said; kept on this device only. */
  words: string;
  language: string;
  /** False when Chrome's language detector was unsure, as it often is on a short message. */
  languageSure?: boolean;
  reading: Reading;
  /** The shop's currency when the entry was read, which plain "shillings" in the words follow. */
  shopCurrency?: string;
  /** The device's first reading when the cloud's second opinion replaced it. */
  firstReading?: Reading;
  status: Status;
  problems: string[];
  hops: Hop[];
}

export type Period = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'all';

export type Intent =
  | 'owed_by'
  | 'who_owes'
  | 'sales_total'
  | 'expenses_total'
  | 'profit'
  | 'top_items'
  | 'item_sales';

export const INTENTS: readonly Intent[] = [
  'owed_by',
  'who_owes',
  'sales_total',
  'expenses_total',
  'profit',
  'top_items',
  'item_sales',
];

export const PERIODS: readonly Period[] = ['today', 'yesterday', 'this_week', 'this_month', 'all'];

/** A question about the book, turned into something code can answer. */
export interface Query {
  intent: Intent;
  person: string | null;
  item: string | null;
  period: Period;
}
