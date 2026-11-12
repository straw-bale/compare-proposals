import { UserFacingError } from "./claude.js";

// Large PDFs (over Vercel's 4.5 MB request limit) go from the browser straight into a private Supabase Storage
// bucket through a one-time signed upload link; the server then reads them from there, passes them to Anthropic and
// deletes them. Server-side only: the browser only ever gets the signed link for one new file.

export const BUCKET = "pdf-uploads";
/** Uploaded objects are named by a random id, never by the user's file name. */
export const STORED_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** RFP PDFs kept with their review, so its page references can open the original: rfp/<review id>-<n>.pdf. */
export const RFP_PATH = /^rfp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{1,2}\.pdf$/;
export const rfpPath = (reviewId: string, index: number) => `rfp/${reviewId}-${index}.pdf`;
/** How long a review's PDFs are kept. */
export const RFP_KEEP_DAYS = 30;

const base = () => `${process.env.SUPABASE_URL!.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "")}/storage/v1`;
const auth = () => {
  const key = process.env.SUPABASE_SECRET_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
};

export function storageConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base()}${path}`, { ...init, headers: { ...auth(), ...init.headers } });
}

/** Creates the private bucket the first time it's needed (PDFs only, up to 50 MB each). */
async function ensureBucket(): Promise<void> {
  const res = await call("/bucket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 50 * 1024 * 1024, allowed_mime_types: ["application/pdf"] }),
  });
  if (!res.ok && res.status !== 409 && !/already exists/i.test(await res.text())) throw new UserFacingError("Couldn't set up file storage.", 502);
}

/** A one-time link the browser can PUT one PDF to (valid two hours). */
export async function signUpload(path: string): Promise<string> {
  const sign = () => call(`/object/upload/sign/${BUCKET}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  let res = await sign();
  // A missing bucket comes back as "Bucket not found" or "The related resource does not exist".
  if (!res.ok && /not found|does not exist/i.test(await res.clone().text())) {
    await ensureBucket();
    res = await sign();
  }
  if (!res.ok) {
    console.error(`[storage] sign ${res.status}: ${(await res.text()).slice(0, 300)}`);
    throw new UserFacingError("Couldn't prepare the upload.", 502);
  }
  const { url } = (await res.json()) as { url: string };
  return `${base()}${url}`;
}

export async function download(path: string): Promise<Buffer> {
  const res = await call(`/object/${BUCKET}/${path}`);
  if (!res.ok) throw new UserFacingError(res.status === 404 || res.status === 400 ? "The uploaded file wasn't found. Try adding it again." : "Couldn't read the uploaded file.", 502);
  return Buffer.from(await res.arrayBuffer());
}

/** Best effort: a failed delete is logged, and anything left behind is removed by cleanupStored. */
export async function remove(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const res = await call(`/object/${BUCKET}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  if (!res.ok) console.error(`[storage] delete ${res.status}`);
}

/** The oldest objects under a prefix older than maxAge, as full paths (at most 100 per call). */
async function olderThan(prefix: string, maxAge: number): Promise<string[]> {
  const res = await call(`/object/list/${BUCKET}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: "created_at", order: "asc" } }),
  });
  if (!res.ok) return [];
  const items = (await res.json()) as { name: string; created_at: string | null }[];
  return items
    .filter((o) => o.created_at && Date.now() - Date.parse(o.created_at) > maxAge)
    .map((o) => (prefix ? `${prefix.replace(/\/$/, "")}/${o.name}` : o.name));
}

/**
 * Removes passing-through uploads older than a day (left behind when a review was abandoned after uploading), and
 * kept RFP PDFs older than 30 days. Never throws.
 */
export async function cleanupStored(): Promise<void> {
  try {
    await remove(await olderThan("", MAX_AGE_MS));
    await remove(await olderThan("rfp", RFP_KEEP_DAYS * 24 * 60 * 60 * 1000));
  } catch (err) {
    console.error("[storage] cleanup failed:", (err as Error).message);
  }
}

/** A short-lived link to read one kept PDF (opened in the browser's own PDF viewer). */
export async function signDownload(path: string, seconds = 600): Promise<string | null> {
  const res = await call(`/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) return null; // gone: deleted with its review, or after 30 days
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${base()}${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
}
