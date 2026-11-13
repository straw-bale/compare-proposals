import { emptyWorldView, type Pursuit, type WorldView } from "../lib/worldview";
import type { Comparison, ProjectCheck, Proposal, Rfp } from "../lib/claude";
import type { Contact } from "./contacts";
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
  /** the original PDFs, kept in storage for 30 days from storedAt so page references can open them */
  stored?: { name: string; path: string; /** when this file was kept (addenda come later); else storedAt */ at?: number }[];
  storedAt?: number;
  /** addenda read into the review after it was made, with what each changed (pages are the addendum's) */
  addenda?: {
    number: number;
    files: string[];
    at: number;
    changes: { section: string; change: string; page: number }[];
    costUsd: number | null;
    /** where the addendum's first PDF sits in stored, when it was kept */
    storedIndex?: number;
  }[];
  /** the team's world view this review was judged with, and when that world view was saved */
  lens?: { text: string; savedAt: number };
};

const DB = "proposal-comparison";
const STORE = "comparisons";
const READINGS = "readings";
const RFPS = "rfps";
const PROJECTS = "projects";
const CONSULTANTS = "consultants";
const SCHEDULES = "schedules";
const FEES = "fees";
const SETTINGS = "settings";
const PURSUITS = "pursuits";

/** A consultant firm in the directory. Firms from proposals that aren't saved are listed from the proposals. */
export type SavedConsultant = {
  id: string;
  savedAt: number;
  name: string;
  /** from the governing discipline list */
  disciplines: string[];
  /** anything else they do (Acoustics, Lighting, ...) */
  specialties?: string[];
  location?: string;
  contacts?: Contact[];
  /** contacts saved before they had separate fields ("Name (Role), email, phone; next person…") */
  contact?: string;
  website?: string;
  certifications?: string;
  notes?: string;
  source: "manual" | "list";
};

/** A project ties an RFP review and its comparisons together (they store its id as projectId). */
export type ConsultantStatus = "candidate" | "asked" | "teaming";
export const CONSULTANT_STATUS: Record<ConsultantStatus, string> = { candidate: "Candidate", asked: "Asked", teaming: "Teaming" };

export type SavedProject = {
  id: string;
  savedAt: number;
  name: string;
  /** The firm's own project number, optional; shown before the name. */
  number?: string;
  rfpId?: string;
  /** Consultants added to the project by hand (firms whose proposals are linked are shown from the proposals). */
  /**
   * Firms for the project's disciplines and where each stands for each discipline (statuses, by discipline): a
   * candidate we're considering, asked (we've reached out), or teaming (willing to propose with us). A discipline with
   * no status counts as asked (entries saved before statuses existed).
   */
  consultants?: { name: string; disciplines: string[]; statuses?: Record<string, ConsultantStatus> }[];
  /** Disciplines the RFP review requests that this project doesn't need a consultant for. */
  disciplinesRemoved?: string[];
  /** The last check of its proposals against the RFP. firms[i] names firm_index i; comparisonIds are what was checked. */
  check?: ProjectCheck & { firms: string[]; comparisonIds: string[]; checkedAt: number; costUsd: number | null };
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 8);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(READINGS)) db.createObjectStore(READINGS, { keyPath: "hash" });
      if (!db.objectStoreNames.contains(RFPS)) db.createObjectStore(RFPS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CONSULTANTS)) db.createObjectStore(CONSULTANTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SCHEDULES)) db.createObjectStore(SCHEDULES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FEES)) db.createObjectStore(FEES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PURSUITS)) db.createObjectStore(PURSUITS, { keyPath: "id" });
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

type Kind = "comparisons" | "rfps" | "readings" | "projects" | "consultants" | "schedules" | "fees" | "settings" | "pursuits";
const LOCAL: Record<Kind, string> = { comparisons: STORE, rfps: RFPS, readings: READINGS, projects: PROJECTS, consultants: CONSULTANTS, schedules: SCHEDULES, fees: FEES, settings: SETTINGS, pursuits: PURSUITS };
let local = false;
/** False once the app has fallen back to this browser's storage (Supabase not configured). */
export const savesShared = () => !local;

async function remote<T>(method: string, kind: Kind, opts: { key?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T | undefined> {
  if (local) return undefined;
  const q = new URLSearchParams({ table: kind, ...(opts.key ? { key: opts.key } : {}) });
  const res = await fetch(`/api/db?${q}`, {
    method,
    headers: { "x-access-code": accessCode(), ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    // Lets a save started as the page closes finish after it's gone.
    keepalive: opts.keepalive,
  });
  if (res.status === 503) {
    local = true;
    return undefined;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Couldn't save (${res.status}).`);
  return data as T;
}

async function saveRecord(kind: Kind, record: object, keepalive = false): Promise<void> {
  if (!local) {
    await remote("POST", kind, { body: record, keepalive });
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


export const saveProject = (p: SavedProject) => saveRecord("projects", p);
export const listProjects = () => listRecords<SavedProject>("projects");
export const deleteProject = (id: string) => deleteRecord("projects", id);
export const saveConsultant = (c: SavedConsultant) => saveRecord("consultants", c);
export const listConsultants = () => listRecords<SavedConsultant>("consultants");
export const deleteConsultant = (id: string) => deleteRecord("consultants", id);

/** A schedule, as the schedule editor keeps it (title, tasks, legend, view…); linked to a project by workspaceProjectId. */
export type SavedSchedule = { id: string; savedAt: number; createdAt?: number; title?: string; workspaceProjectId?: string } & Record<string, unknown>;
/** keepalive: for the last save as the page closes. */
export const saveSchedule = (s: SavedSchedule, keepalive = false) => saveRecord("schedules", s, keepalive);
export const listSchedules = () => listRecords<SavedSchedule>("schedules");
export const deleteSchedule = (id: string) => deleteRecord("schedules", id);

/** A role on the fee (Principal, Project Manager, ...) with its hourly billing rate. */
/** A role on the fee with its hourly rate; short is its abbreviation in table headings (e.g. PM). */
export type FeeRole = { id: string; name: string; rate: number | null; short?: string };
export type FeeTask = { id: string; name: string; /** hours by role id */ hours: Record<string, number> };
export type FeePhase = { id: string; name: string; /** typical share of labor, in percent */ targetShare: number; tasks: FeeTask[] };
export type FeeConsultant = { id: string; discipline: string; firm: string; /** quoted fee by phase id */ byPhase: Record<string, number> };

/** A fee being built for a project: labor by phase and role, consultants with a management markup, and a budget. */
export type SavedFee = {
  id: string;
  savedAt: number;
  title: string;
  workspaceProjectId?: string;
  /** the template it started from */
  template: string;
  /** construction budget: typed as an amount, or worked out as area × cost per square foot */
  budget: {
    /** how the budget is set: an amount typed in, or area × cost per square foot (older fees: worked out) */
    by?: "amount" | "area";
    amount: number | null;
    area: number | null;
    costPerSf: number | null;
  };
  /** the top-down fee, as a percent of the construction budget */
  targetPercent: number | null;
  roles: FeeRole[];
  phases: FeePhase[];
  consultants: FeeConsultant[];
  /** the architect's management markup on consultant fees, in percent */
  markupPercent: number;
  /** reimbursable expenses */
  expenses: number | null;
  /** how long the project runs, in months, for the hours-over-time chart */
  durationMonths?: number | null;
  /** the world view an AI draft was made with, and when that world view was saved */
  lens?: { text: string; savedAt: number };
  /** the target percent comes from the World view's fee curve, and follows the budget until someone types one */
  targetFromCurve?: boolean;
  /** set when the fee was drafted by AI from the RFP review: what it assumed, and what the draft cost */
  draft?: {
    basis: string;
    assumptions: string[];
    costUsd: number | null;
    at: number;
    /** "notes" when the list was started on the worksheet or by the assistant, not drafted from the RFP review */
    source?: "notes";
    /** when the AI assistant last revised the list */
    revisedAt?: number;
  };
};

export const saveFee = (f: SavedFee, keepalive = false) => saveRecord("fees", f, keepalive);
export const listFees = () => listRecords<SavedFee>("fees");
export const deleteFee = (id: string) => deleteRecord("fees", id);
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

// ---------- World view ----------

/** The team's world view, or the starting one (empty text, placeholder fee curve) until someone saves it. */
export async function getWorldView(): Promise<WorldView> {
  const saved = (await listRecords<WorldView>("settings")).find((r) => r.id === "worldview");
  return saved ? { ...emptyWorldView(), ...saved } : emptyWorldView();
}
export const saveWorldView = (w: WorldView, keepalive = false) => saveRecord("settings", w, keepalive);

export const listPursuits = () => listRecords<Pursuit>("pursuits");
export const savePursuit = (p: Pursuit) => saveRecord("pursuits", p);
export const deletePursuit = (id: string) => deleteRecord("pursuits", id);
