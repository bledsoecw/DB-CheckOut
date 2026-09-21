/**
 * Where the app keeps what it must not lose: the session, the outbox, the
 * visit in progress (photos included), the caches.
 *
 * On the web AsyncStorage is localStorage, which iOS Safari caps at about
 * 5 MB per site — and past that a write throws or silently keeps the old
 * value. A visit with a dozen photos as data URIs went straight through
 * that limit, and a reload then came back with the last snapshot that fit.
 * IndexedDB holds hundreds of MB, so everything lives there now. The first
 * read of a key still finds anything localStorage had and moves it over,
 * so nothing saved on a phone before this change is lost.
 *
 * Where IndexedDB is missing or refuses (some private windows, an old
 * WebView), the AsyncStorage path is used exactly as before.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const DB_NAME = "db-checkout";
const STORE = "kv";
/** Safari has been known to never answer an open(); don't let that hang the app. */
const OPEN_TIMEOUT_MS = 3000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!factory) return done(null);
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        // If the database is deleted or upgraded elsewhere, reopen next time.
        req.result.onclose = () => {
          dbPromise = null;
        };
        req.result.onversionchange = () => {
          req.result.close();
          dbPromise = null;
        };
        done(req.result);
      };
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
      setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/** The same three calls the app used on AsyncStorage. */
export const storage = {
  async getItem(key: string): Promise<string | null> {
    const db = await openDb();
    if (!db) return AsyncStorage.getItem(key);
    try {
      const value = await run<unknown>(db, "readonly", (s) => s.get(key));
      if (typeof value === "string") return value;
      // First read of this key since the move: bring over what localStorage
      // had, then free its space — that 5 MB is the whole reason for this.
      const legacy = await AsyncStorage.getItem(key).catch(() => null);
      if (legacy != null) {
        await run(db, "readwrite", (s) => s.put(legacy, key)).catch(() => {});
        void AsyncStorage.removeItem(key).catch(() => {});
      }
      return legacy;
    } catch {
      return AsyncStorage.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const db = await openDb();
    if (!db) return AsyncStorage.setItem(key, value);
    try {
      await run(db, "readwrite", (s) => s.put(value, key));
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    const db = await openDb();
    if (db) await run(db, "readwrite", (s) => s.delete(key)).catch(() => {});
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
