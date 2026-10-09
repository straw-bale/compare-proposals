import type { Comparison, Proposal } from "../lib/claude";
import type { Sourced } from "./table";

// Saved comparisons live only in this browser (IndexedDB). Nothing here is shared or sent anywhere.

export type ChatMessage = { role: "user" | "assistant"; text: string; updated?: boolean; cost?: number | null };

export type SavedComparison = {
  id: string;
  savedAt: number;
  projectName: string | null;
  proposals: Sourced[];
  cmp: Comparison;
  messages: ChatMessage[];
  /** Total API spend on this comparison (reading, comparing, chat); costPartial if any step's cost was unknown. */
  costUsd?: number;
  costPartial?: boolean;
};

/** A PDF's reading, saved by a hash of the file's contents so the same PDF is never paid for twice. */
export type SavedReading = {
  hash: string;
  proposal: Proposal;
  file_id: string;
  /** when file_id was uploaded; Anthropic copies are deleted after a day */
  uploadedAt: number;
  pdf_tokens?: number;
};

const DB = "proposal-comparison";
const STORE = "comparisons";
const READINGS = "readings";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(READINGS)) db.createObjectStore(READINGS, { keyPath: "hash" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
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

export async function getReading(hash: string): Promise<SavedReading | undefined> {
  try {
    return await run<SavedReading | undefined>("readonly", (s) => s.get(hash), READINGS);
  } catch {
    return undefined;
  }
}

export async function saveReading(r: SavedReading): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(r), READINGS);
  } catch {}
}

/** SHA-256 of the file's bytes, or null where the browser doesn't allow it (non-HTTPS pages). */
export async function hashFile(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
