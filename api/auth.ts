import { checkAccess } from "../lib/auth.js";
import { errorResponse } from "../lib/claude.js";

// Lets the page check an access code (or learn that none is required) before showing the app.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
