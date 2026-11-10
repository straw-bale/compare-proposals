import { checkAccess } from "../lib/auth.js";
import { errorResponse, uploadPdf, UserFacingError } from "../lib/claude.js";
import { download, remove, STORED_PATH } from "../lib/storage.js";

// Passes a PDF to Anthropic's file storage and returns its file_id. Either the PDF itself is the request body
// (up to Vercel's 4.5 MB limit), or, for larger files, JSON naming a PDF the browser already put in storage
// through /api/upload-url; that copy is deleted once Anthropic has it.
export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { path?: unknown; filename?: unknown } | null;
      const path = typeof body?.path === "string" ? body.path : "";
      if (!STORED_PATH.test(path)) throw new UserFacingError("Invalid upload.");
      const filename = typeof body?.filename === "string" && body.filename ? body.filename.slice(0, 200) : "document.pdf";
      const pdf = await download(path);
      try {
        if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
        return Response.json({ file_id: await uploadPdf(pdf, filename) });
      } finally {
        await remove([path]);
      }
    }
    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "proposal.pdf");
    const pdf = Buffer.from(await request.arrayBuffer());
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new UserFacingError("That file isn't a PDF.");
    return Response.json({ file_id: await uploadPdf(pdf, filename) });
  } catch (err) {
    return errorResponse(err);
  }
}
