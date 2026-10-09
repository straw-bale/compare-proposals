import type { Comparison } from "../lib/claude";
import type { Sourced } from "./table";

// Saved comparisons live only in this browser (IndexedDB). Nothing here is shared or sent anywhere.

export type ChatMessage = { role: "user" | "assistant"; text: string; updated?: boolean };

export type SavedComparison = {
  id: string;
  savedAt: number;
  projectName: string | null;
  proposals: Sourced[];
  cmp: Comparison;
  messages: ChatMessage[];
};

const DB = "proposal-comparison";
const STORE = "comparisons";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Storage can be unavailable (private windows, blocked site data); every call degrades to a no-op.
export async function saveComparison(c: SavedComparison): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(c));
  } catch {}
}

export async function listComparisons(): Promise<SavedComparison[]> {
  try {
    const all = await run<SavedComparison[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function deleteComparison(id: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {}
}
