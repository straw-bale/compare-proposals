import { checkAccess } from "../lib/auth.js";
import { askFeeAssistant, draftFee, errorResponse, UserFacingError, type Rfp } from "../lib/claude.js";
import { firmContext } from "../lib/worldview.js";
import { worldViewContext } from "../lib/worldview-server.js";
import { z } from "zod";

// With x-action "chat", the fee worksheet's assistant instead (see ChatBody), which reads the saved world view.
// Drafts a starting fee (the firm's own architecture and interiors work) from a project's RFP review. Reviews saved before newer fields existed may lack them, so the
// review is taken as saved; it only goes into the prompt as JSON.
const Body = z.object({
  rfp: z.object({}).passthrough(),
  roles: z.array(z.object({ id: z.string().max(100), name: z.string().max(200), rate: z.number().nullable() })).min(1).max(40),
  // The firm's world view and the past pursuits most like this RFP, as the World view page shows them.
  worldView: z.string().max(20_000).default(""),
  pursuits: z.array(z.string().max(3_000)).max(20).default([]),
});

const ChatBody = z.object({
  worksheet: z.object({}).passthrough(),
  rfp: z.object({}).passthrough().nullable().default(null),
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_000) }))
    .min(1)
    .max(40)
    .refine((t) => t[t.length - 1].role === "user"),
});
const MAX_CHAT_BYTES = 1_000_000;

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (request.headers.get("x-action") === "chat") {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_CHAT_BYTES) throw new UserFacingError("This fee is too large to send.", 413);
      const chat = ChatBody.safeParse(await request.json().catch(() => null));
      if (!chat.success) throw new UserFacingError("Invalid fee assistant request.");
      return Response.json(await askFeeAssistant(chat.data.worksheet, chat.data.rfp, chat.data.turns, await worldViewContext()));
    }
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid fee draft request.");
    return Response.json(await draftFee(parsed.data.rfp as Rfp, parsed.data.roles, firmContext(parsed.data.worldView, parsed.data.pursuits)));
  } catch (err) {
    return errorResponse(err);
  }
}
