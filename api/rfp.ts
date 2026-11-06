import { checkAccess } from "../lib/auth.js";
import { cleanupOldFiles, errorResponse, reviewRfp, UserFacingError } from "../lib/claude.js";
import { z } from "zod";

// PDFs are uploaded first (one request each, via /api/upload) to stay under Vercel's body limit.
const Body = z.object({ files: z.array(z.object({ file_id: z.string(), filename: z.string() })).min(1).max(10) });

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid RFP request.");
    const [result] = await Promise.all([reviewRfp(parsed.data.files), cleanupOldFiles()]);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
