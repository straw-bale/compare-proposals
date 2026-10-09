import { checkAccess } from "../lib/auth.js";
import { cleanupOldFiles, compareProposals, errorResponse, ProposalSchema, UserFacingError } from "../lib/claude.js";
import { z } from "zod";

const Body = z.object({ projectName: z.string().nullable(), proposals: z.array(ProposalSchema).min(1) });

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid comparison request.");
    // Each run also clears out PDFs uploaded more than a day ago.
    const [result] = await Promise.all([
      compareProposals(parsed.data.proposals, parsed.data.projectName),
      cleanupOldFiles(),
    ]);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
