import { checkAccess } from "../lib/auth.js";
import { errorResponse, UserFacingError } from "../lib/claude.js";
import { dbConfigured, get, list, put, remove, TABLES, type Table } from "../lib/db.js";

// /api/db?table=rfps|comparisons|readings[&key=...]
//   GET: list (or one record with key) · POST: save the JSON body · DELETE: delete key
// 503 when Supabase isn't configured; the browser then keeps saving locally.

function params(request: Request): { table: Table; key: string | null } {
  checkAccess(request);
  if (!dbConfigured()) throw new UserFacingError("Database not configured.", 503);
  const url = new URL(request.url);
  const table = url.searchParams.get("table") as Table;
  if (!(table in TABLES)) throw new UserFacingError("Unknown table.");
  return { table, key: url.searchParams.get("key") };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { table, key } = params(request);
    return Response.json(key ? await get(table, key) : await list(table));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { table } = params(request);
    const record = await request.json().catch(() => null);
    if (!record || typeof record !== "object") throw new UserFacingError("Invalid record.");
    await put(table, record);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { table, key } = params(request);
    if (!key) throw new UserFacingError("Missing key.");
    await remove(table, key);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
