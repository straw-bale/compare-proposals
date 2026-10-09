import { chat, ComparisonSchema, errorResponse, ProposalSchema, UserFacingError } from "../lib/claude.js";
import { z } from "zod";

const Body = z.object({
  projectName: z.string().nullable(),
  proposals: z
    .array(ProposalSchema.extend({ file_id: z.string().regex(/^file_[A-Za-z0-9_-]+$/), source_file: z.string() }))
    .min(1),
  comparison: ComparisonSchema,
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20000) }))
    .min(1)
    .refine((t) => t.length > 0 && t[0].role === "user" && t[t.length - 1].role === "user", "Conversation must start and end with a user turn."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid chat request.");
    const { proposals, comparison, projectName, turns } = parsed.data;
    return Response.json(await chat(proposals, comparison, projectName, turns));
  } catch (err) {
    return errorResponse(err);
  }
}
