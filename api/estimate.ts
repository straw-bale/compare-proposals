import { checkAccess } from "../lib/auth.js";
import { countPdfTokens, errorResponse, UserFacingError } from "../lib/claude.js";

// Measures a PDF's input tokens before anything is spent, so the page can show a cost estimate.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const pdf = Buffer.from(await request.arrayBuffer());
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
    return Response.json({ input_tokens: await countPdfTokens(pdf) });
  } catch (err) {
    return errorResponse(err);
  }
}
