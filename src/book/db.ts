// The book lives in this browser's IndexedDB. Nothing here is sent anywhere.

import { openDB, type IDBPDatabase } from 'idb';
import type { Entry } from './types';

const NAME = 'imali-ai-hybrid';
let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB(NAME, 1, {
    upgrade(d) {
      const s = d.createObjectStore('entries', { keyPath: 'id' });
      s.createIndex('createdAt', 'createdAt');
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

export async function allEntries(): Promise<Entry[]> {
  const list = (await (await db()).getAllFromIndex('entries', 'createdAt')) as Entry[];
  return list.reverse();
}

export async function getEntry(id: string): Promise<Entry | undefined> {
  return (await (await db()).get('entries', id)) as Entry | undefined;
}

export async function saveEntry(e: Entry): Promise<void> {
  await (await db()).put('entries', e);
}

export async function deleteEntry(id: string): Promise<void> {
  await (await db()).delete('entries', id);
}

export async function clearBook(): Promise<void> {
  await (await db()).clear('entries');
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get('meta', key);
  return (v as T | undefined) ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}
