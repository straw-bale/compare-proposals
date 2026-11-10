import { checkAccess } from "../lib/auth.js";
import { countPdfTokens, errorResponse, uploadPdf, UserFacingError } from "../lib/claude.js";
import { cleanupStored, download, remove, signUpload, storageConfigured, STORED_PATH } from "../lib/storage.js";

// Everything about getting a PDF to Anthropic, in one function (the Hobby plan allows 12 per deployment).
// The x-action header picks the job:
//  - "estimate": the body is a PDF; returns its input tokens (free to count), so the page can show a cost estimate.
//  - "sign": returns a one-time link to upload one PDF straight to storage, for files over Vercel's 4.5 MB limit.
//  - none: passes a PDF to Anthropic's file storage and returns its file_id. The body is either the PDF itself, or
//    JSON naming a PDF already put in storage through "sign"; that copy is deleted once Anthropic has it.
const isPdf = (pdf: Buffer) => pdf.subarray(0, 5).toString() === "%PDF-";

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    const action = request.headers.get("x-action");

    if (action === "estimate") {
      const pdf = Buffer.from(await request.arrayBuffer());
      if (!isPdf(pdf)) throw new UserFacingError("That file isn't a PDF.");
      return Response.json({ input_tokens: await countPdfTokens(pdf) });
    }

    if (action === "sign") {
      if (!storageConfigured()) throw new UserFacingError("PDFs over 4.4 MB need the database (Supabase) set up.", 503);
      const path = `${crypto.randomUUID()}.pdf`;
      const [url] = await Promise.all([signUpload(path), cleanupStored()]);
      return Response.json({ url, path });
    }

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { path?: unknown; filename?: unknown } | null;
      const path = typeof body?.path === "string" ? body.path : "";
      if (!STORED_PATH.test(path)) throw new UserFacingError("Invalid upload.");
      const filename = typeof body?.filename === "string" && body.filename ? body.filename.slice(0, 200) : "document.pdf";
      const pdf = await download(path);
      try {
        if (!isPdf(pdf)) throw new UserFacingError("That file isn't a PDF.");
        return Response.json({ file_id: await uploadPdf(pdf, filename) });
      } finally {
        await remove([path]);
      }
    }

    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "proposal.pdf");
    const pdf = Buffer.from(await request.arrayBuffer());
    if (!isPdf(pdf)) throw new UserFacingError("That file isn't a PDF.");
    return Response.json({ file_id: await uploadPdf(pdf, filename) });
  } catch (err) {
    return errorResponse(err);
  }
}
