import { checkAccess } from "../lib/auth.js";
import { draftFee, errorResponse, UserFacingError, type Rfp } from "../lib/claude.js";
import { z } from "zod";

// Drafts a starting fee (the firm's own architecture and interiors work) from a project's RFP review. Reviews saved before newer fields existed may lack them, so the
// review is taken as saved; it only goes into the prompt as JSON.
const Body = z.object({
  rfp: z.object({}).passthrough(),
  roles: z.array(z.object({ id: z.string().max(100), name: z.string().max(200), rate: z.number().nullable() })).min(1).max(40),
});

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid fee draft request.");
    return Response.json(await draftFee(parsed.data.rfp as Rfp, parsed.data.roles));
  } catch (err) {
    return errorResponse(err);
  }
}
