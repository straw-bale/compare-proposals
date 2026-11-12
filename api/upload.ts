import { checkAccess } from "../lib/auth.js";
import { countPdfTokens, errorResponse, uploadPdf, UserFacingError } from "../lib/claude.js";
import { cleanupStored, download, remove, RFP_PATH, rfpPath, signDownload, signUpload, storageConfigured, STORED_PATH } from "../lib/storage.js";

// Everything about getting a PDF to Anthropic, in one function (the Hobby plan allows 12 per deployment).
// The x-action header picks the job:
//  - "estimate": the body is a PDF; returns its input tokens (free to count), so the page can show a cost estimate.
//  - "sign": returns a one-time link to upload one PDF straight to storage (files over Vercel's 4.5 MB limit, and
//    RFP PDFs, which are kept with their review for 30 days so page references can open them);
//  - "view": a short-lived link to read a kept RFP PDF; "delete-stored": deletes a review's kept PDFs.
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
      // An RFP review's PDFs are kept (rfp/<review id>-<n>.pdf) so its page references can open them; anything else
      // passes through under a random name.
      const keep = (await request.json().catch(() => null)) as { reviewId?: unknown; index?: unknown } | null;
      const reviewId = typeof keep?.reviewId === "string" ? keep.reviewId : "";
      const index = Number(keep?.index);
      const path = reviewId && Number.isInteger(index) && index >= 0 && index < 100 ? rfpPath(reviewId, index) : `${crypto.randomUUID()}.pdf`;
      if (reviewId && !RFP_PATH.test(path)) throw new UserFacingError("Invalid upload.");
      const [url] = await Promise.all([signUpload(path), cleanupStored()]);
      return Response.json({ url, path });
    }

    if (action === "view") {
      // A short-lived link to a kept RFP PDF.
      const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
      const path = typeof body?.path === "string" ? body.path : "";
      if (!RFP_PATH.test(path)) throw new UserFacingError("Invalid file.");
      const url = await signDownload(path);
      if (!url) throw new UserFacingError("The original PDF is no longer stored (they're kept for 30 days).", 404);
      return Response.json({ url });
    }

    if (action === "delete-stored") {
      // A review's kept PDFs, deleted with the review.
      const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
      const paths = Array.isArray(body?.paths) ? body.paths.filter((p): p is string => typeof p === "string" && RFP_PATH.test(p)).slice(0, 20) : [];
      await remove(paths);
      return Response.json({ ok: true });
    }

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { path?: unknown; filename?: unknown } | null;
      const path = typeof body?.path === "string" ? body.path : "";
      const kept = RFP_PATH.test(path);
      if (!STORED_PATH.test(path) && !kept) throw new UserFacingError("Invalid upload.");
      const filename = typeof body?.filename === "string" && body.filename ? body.filename.slice(0, 200) : "document.pdf";
      const pdf = await download(path);
      try {
        if (!isPdf(pdf)) throw new UserFacingError("That file isn't a PDF.");
        return Response.json({ file_id: await uploadPdf(pdf, filename) });
      } finally {
        // Passing-through uploads go as soon as Anthropic has them; an RFP review's are kept for 30 days.
        if (!kept) await remove([path]);
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
