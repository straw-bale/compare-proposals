import { checkAccess } from "../lib/auth.js";
import { errorResponse, UserFacingError } from "../lib/claude.js";
import { addFeedback, dbConfigured } from "../lib/db.js";
import { z } from "zod";

const Body = z.object({ message: z.string().trim().min(1).max(5000), tab: z.string().max(40).nullable() });

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (!dbConfigured()) throw new UserFacingError("Feedback isn't set up on this site yet.", 503);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Please write a message first.");
    await addFeedback(parsed.data.message, parsed.data.tab);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
