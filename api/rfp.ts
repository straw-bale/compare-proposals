import { checkAccess } from "../lib/auth.js";
import { cleanupOldFiles, errorResponse, fitCheck, reviewRfp, suggestWorldView, UserFacingError } from "../lib/claude.js";
import { firmContext } from "../lib/worldview.js";
import { z } from "zod";

// RFP reviews and the World view's checks, in one function (the Hobby plan allows 12 per deployment).
// The x-action header picks the job:
//  - none: review uploaded PDFs (uploaded first, one request each, via /api/upload, to stay under Vercel's body limit);
//  - "fit-check": the pursue / consider / pass verdict for a saved review's JSON;
//  - "suggest": suggested world view edits from how verdicts compared with outcomes.
// The firm's world view and past pursuits come from the browser as text, and are added after the built-in
// instructions exactly as the World view page shows them.
const Context = {
  worldView: z.string().max(20_000).default(""),
  pursuits: z.array(z.string().max(3_000)).max(20).default([]),
};
const Review = z.object({ files: z.array(z.object({ file_id: z.string(), filename: z.string() })).min(1).max(10), ...Context });
const FitCheck = z.object({ rfp: z.object({}).passthrough(), ...Context });
const Suggest = z.object({ worldView: z.string().max(20_000), results: z.array(z.object({}).passthrough()).min(1).max(60) });

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const action = request.headers.get("x-action");
    const body = await request.json().catch(() => null);

    if (action === "fit-check") {
      const p = FitCheck.safeParse(body);
      if (!p.success) throw new UserFacingError("Invalid check request.");
      return Response.json(await fitCheck(p.data.rfp, firmContext(p.data.worldView, p.data.pursuits)));
    }
    if (action === "suggest") {
      const p = Suggest.safeParse(body);
      if (!p.success) throw new UserFacingError("Invalid request.");
      return Response.json(await suggestWorldView(p.data.worldView, p.data.results));
    }

    const p = Review.safeParse(body);
    if (!p.success) throw new UserFacingError("Invalid RFP request.");
    const [result] = await Promise.all([reviewRfp(p.data.files, firmContext(p.data.worldView, p.data.pursuits)), cleanupOldFiles()]);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
