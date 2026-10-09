import { extractProposal, errorResponse, UserFacingError } from "../lib/claude.js";

// Body is the raw PDF bytes; filename comes in a header.
export async function POST(request: Request): Promise<Response> {
  try {
    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "proposal.pdf");
    const pdf = Buffer.from(await request.arrayBuffer());
    if (pdf.length === 0) throw new UserFacingError("Empty file.");
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
    return Response.json(await extractProposal(pdf, filename));
  } catch (err) {
    return errorResponse(err);
  }
}
