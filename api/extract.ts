import { checkAccess } from "../lib/auth.js";
import { extractProposal, errorResponse, summarizeOwnProposal, UserFacingError } from "../lib/claude.js";

// Reads a proposal PDF. Body is the raw PDF bytes; filename comes in a header.
// With x-action "summarize-own", it summarises a proposal the firm itself submitted instead (for the World view's
// past pursuits); the body is then JSON naming a PDF already passed to Anthropic through /api/upload.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (request.headers.get("x-action") === "summarize-own") {
      const body = (await request.json().catch(() => null)) as { file_id?: unknown; filename?: unknown } | null;
      if (typeof body?.file_id !== "string" || !/^[\w-]{1,200}$/.test(body.file_id)) throw new UserFacingError("Invalid request.");
      const filename = typeof body.filename === "string" ? body.filename.slice(0, 200) : "proposal.pdf";
      return Response.json(await summarizeOwnProposal(body.file_id, filename));
    }
    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "proposal.pdf");
    const pdf = Buffer.from(await request.arrayBuffer());
    if (pdf.length === 0) throw new UserFacingError("Empty file.");
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
    return Response.json(await extractProposal(pdf, filename));
  } catch (err) {
    return errorResponse(err);
  }
}
