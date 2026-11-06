import type { Comparison, ProjectCheck, Proposal, Rfp } from "../lib/claude";
import type { Sourced } from "./table";
import { accessCode } from "./api";


export type ChatMessage = { role: "user" | "assistant"; text: string; updated?: boolean; cost?: number | null };

export type SavedComparison = {
  id: string;
  savedAt: number;
  projectName: string | null;
  projectId?: string;
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
  projectId?: string;
  costUsd?: number | null;
};

const DB = "proposal-comparison";
const STORE = "comparisons";
const READINGS = "readings";
const RFPS = "rfps";
const PROJECTS = "projects";

/** A project ties an RFP review and its comparisons together (they store its id as projectId). */
export type SavedProject = {
  id: string;
  savedAt: number;
  name: string;
  /** The firm's own project number, optional; shown before the name. */
  number?: string;
  rfpId?: string;
  /** The last check of its proposals against the RFP. firms[i] names firm_index i; comparisonIds are what was checked. */
  check?: ProjectCheck & { firms: string[]; comparisonIds: string[]; checkedAt: number; costUsd: number | null };
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(READINGS)) db.createObjectStore(READINGS, { keyPath: "hash" });
      if (!db.objectStoreNames.contains(RFPS)) db.createObjectStore(RFPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
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

type Kind = "comparisons" | "rfps" | "readings" | "projects";
const LOCAL: Record<Kind, string> = { comparisons: STORE, rfps: RFPS, readings: READINGS, projects: PROJECTS };
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
/** "24-017 Gas Dynamics Lab", or just the name when there's no number. Reviews and comparisons show this. */
export const projectLabel = (p: SavedProject) => (p.number ? `${p.number} ${p.name}` : p.name);

/** Asks for a project's number and name. Resolves null on cancel. */
export async function askProjectName(title: string, confirm: string, p: { number?: string; name: string }) {
  const { formModal } = await import("./modal");
  const values = await formModal({
    title,
    fields: [
      { label: "Project number", value: p.number ?? "", placeholder: "Optional" },
      { label: "Project name", value: p.name, required: true },
    ],
    confirm,
  });
  return values && { number: values[0] || undefined, name: values[1] };
}

export const saveProject = (p: SavedProject) => saveRecord("projects", p);
export const listProjects = () => listRecords<SavedProject>("projects");
export const deleteProject = (id: string) => deleteRecord("projects", id);
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
