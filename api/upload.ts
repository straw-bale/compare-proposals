import { checkAccess } from "../lib/auth.js";
import { errorResponse, uploadPdf, UserFacingError } from "../lib/claude.js";

// Re-uploads a PDF for an older saved comparison whose files have expired, so its chat works again.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "proposal.pdf");
    const pdf = Buffer.from(await request.arrayBuffer());
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
    return Response.json({ file_id: await uploadPdf(pdf, filename) });
  } catch (err) {
    return errorResponse(err);
  }
}
