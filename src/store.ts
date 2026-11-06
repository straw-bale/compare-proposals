import type { Comparison, Proposal, Rfp } from "../lib/claude";
import type { Sourced } from "./table";
import { accessCode } from "./api";
import { esc } from "./table";


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

export type SavedRfp = {
  id: string;
  savedAt: number;
  files: string[];
  rfp: Rfp;
  project?: string | null;
  costUsd?: number | null;
};

const DB = "proposal-comparison";
const STORE = "comparisons";
const READINGS = "readings";
const RFPS = "rfps";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(READINGS)) db.createObjectStore(READINGS, { keyPath: "hash" });
      if (!db.objectStoreNames.contains(RFPS)) db.createObjectStore(RFPS, { keyPath: "id" });
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

// ---------- Where records are saved ----------
// Supabase (through /api/db, so the key stays on the server) when it's configured; otherwise this browser's
// IndexedDB. The server answers 503 when Supabase isn't set up, and the app then stays local for the session.

type Kind = "comparisons" | "rfps" | "readings";
const LOCAL: Record<Kind, string> = { comparisons: STORE, rfps: RFPS, readings: READINGS };
let local = false;
/** False once the app has fallen back to this browser's storage (Supabase not configured). */
export const savesShared = () => !local;

async function remote<T>(method: string, kind: Kind, opts: { key?: string; body?: unknown } = {}): Promise<T | undefined> {
  if (local) return undefined;
  const q = new URLSearchParams({ table: kind, ...(opts.key ? { key: opts.key } : {}) });
  const res = await fetch(`/api/db?${q}`, {
    method,
    headers: { "x-access-code": accessCode(), ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 503) {
    local = true;
    return undefined;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Couldn't save (${res.status}).`);
  return data as T;
}

async function saveRecord(kind: Kind, record: object): Promise<void> {
  if (!local) {
    await remote("POST", kind, { body: record });
    if (!local) return;
  }
  try {
    await run("readwrite", (s) => s.put(record), LOCAL[kind]);
  } catch {} // storage can be unavailable (private windows, blocked site data)
}

async function listRecords<T extends { savedAt: number }>(kind: Kind): Promise<T[]> {
  try {
    const rows = (await remote<T[]>("GET", kind)) ?? (await run<T[]>("readonly", (s) => s.getAll(), LOCAL[kind]));
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function deleteRecord(kind: Kind, key: string): Promise<void> {
  if (!local) {
    await remote("DELETE", kind, { key });
    if (!local) return;
  }
  try {
    await run("readwrite", (s) => s.delete(key), LOCAL[kind]);
  } catch {}
}

export const saveComparison = (c: SavedComparison) => saveRecord("comparisons", c);
export const listComparisons = () => listRecords<SavedComparison>("comparisons");
export const deleteComparison = (id: string) => deleteRecord("comparisons", id);
export const saveRfp = (r: SavedRfp) => saveRecord("rfps", r);
export const listRfps = () => listRecords<SavedRfp>("rfps");
export const deleteRfp = (id: string) => deleteRecord("rfps", id);
export const saveReading = (r: SavedReading) => saveRecord("readings", r).catch(console.error);

export async function getReading(hash: string): Promise<SavedReading | undefined> {
  try {
    const row = await remote<SavedReading | null>("GET", "readings", { key: hash });
    if (!local) return row ?? undefined;
    return await run<SavedReading | undefined>("readonly", (s) => s.get(hash), READINGS);
  } catch {
    return undefined;
  }
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

/** Every project name used so far, for the "Add to project" suggestions. */
export async function listProjectNames(): Promise<string[]> {
  const [cmps, rfps] = await Promise.all([listComparisons(), listRfps()]);
  const names = [...cmps.map((c) => c.projectName), ...rfps.map((r) => r.project)].filter((n): n is string => !!n);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Fills the shared <datalist> with existing project names, plus an optional suggestion. */
export async function fillProjectNames(suggest?: string) {
  const names = await listProjectNames();
  if (suggest && !names.includes(suggest)) names.unshift(suggest);
  const list = document.getElementById("project-names");
  if (list) list.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
}
