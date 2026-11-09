import { UserFacingError } from "./claude.js";

// Talks to Supabase's REST API with the secret key. Server-side only; the browser never sees the key.

export const TABLES = { rfps: "rfp_reviews", comparisons: "comparisons", readings: "readings", projects: "projects", consultants: "consultants" } as const;
export type Table = keyof typeof TABLES;

export function dbConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.SUPABASE_URL!.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY!;
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[db] ${res.status} ${path.split("?")[0]}: ${body.slice(0, 300)}`);
    if (/does not exist|schema cache/i.test(body)) throw new UserFacingError("Database tables are missing. Run supabase/schema.sql in the Supabase SQL Editor.", 500);
    if (/permission denied/i.test(body)) throw new UserFacingError("The database refused access. Run the grant line at the end of supabase/schema.sql in the Supabase SQL Editor.", 500);
    throw new UserFacingError(`Database error (${res.status}).`, 502);
  }
  return res;
}

const keyCol = (t: Table) => (t === "readings" ? "hash" : "id");

export async function list(t: Table): Promise<unknown[]> {
  const rows: { data: unknown }[] = await (await sb(`${TABLES[t]}?select=data&order=saved_at.desc&limit=500`)).json();
  return rows.map((r) => r.data);
}

export async function get(t: Table, key: string): Promise<unknown | null> {
  const rows: { data: unknown }[] = await (await sb(`${TABLES[t]}?select=data&${keyCol(t)}=eq.${encodeURIComponent(key)}`)).json();
  return rows[0]?.data ?? null;
}

export async function put(t: Table, record: Record<string, unknown>): Promise<void> {
  const key = record[keyCol(t)];
  if (typeof key !== "string" || !key) throw new UserFacingError("Missing record key.");
  const row: Record<string, unknown> = { [keyCol(t)]: key, data: record, saved_at: new Date().toISOString() };
  if (t === "rfps") row.project = record.project ?? null;
  if (t === "comparisons") row.project = record.projectName ?? null;
  if (t === "projects" || t === "consultants") row.name = record.name ?? null;
  await sb(TABLES[t], { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });
}

export async function remove(t: Table, key: string): Promise<void> {
  await sb(`${TABLES[t]}?${keyCol(t)}=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function addFeedback(message: string, tab: string | null): Promise<void> {
  await sb("feedback", { method: "POST", body: JSON.stringify({ message, tab }) });
}
