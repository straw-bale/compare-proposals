import { checkAccess } from "../lib/auth.js";
import { errorResponse, UserFacingError } from "../lib/claude.js";
import { askScheduleAssistant } from "../lib/schedule-ai.js";
import { worldViewContext } from "../lib/worldview-server.js";

// The schedule editor's assistant. Behind the access code like every other endpoint.
const MAX_TURNS = 40;
const MAX_BODY = 4.4 * 1024 * 1024; // just under Vercel's 4.5 MB request limit

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
      throw new UserFacingError("Request too large — attach a smaller file or a screenshot.", 413);
    const body = (await request.json().catch(() => null)) as { project?: unknown; messages?: { role: string; content: unknown }[] } | null;
    const messages = body?.messages;
    const valid =
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.length <= MAX_TURNS &&
      messages.every((m) => (m?.role === "user" || m?.role === "assistant") && m.content);
    if (!valid) throw new UserFacingError("Invalid conversation.");
    return Response.json(await askScheduleAssistant(body!.project, messages as { role: "user" | "assistant"; content: unknown }[], await worldViewContext()));
  } catch (err) {
    return errorResponse(err);
  }
}
