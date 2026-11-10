import { checkAccess } from "../lib/auth.js";
import { errorResponse, UserFacingError } from "../lib/claude.js";
import { cleanupStored, signUpload, storageConfigured } from "../lib/storage.js";

// For PDFs over Vercel's 4.5 MB request limit: a one-time link to upload one PDF straight to storage.
// The browser then calls /api/upload with the returned path, and the server passes the file on to Anthropic.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (!storageConfigured()) throw new UserFacingError("PDFs over 4.4 MB need the database (Supabase) set up.", 503);
    const path = `${crypto.randomUUID()}.pdf`;
    const [url] = await Promise.all([signUpload(path), cleanupStored()]);
    return Response.json({ url, path });
  } catch (err) {
    return errorResponse(err);
  }
}
