import { checkAccess } from "../lib/auth.js";
import { errorResponse, UserFacingError } from "../lib/claude.js";
import { appOrigin, schedulePdf, type Paper } from "../lib/schedule-pdf.js";
import { z } from "zod";

// A schedule as a PDF, made on the server so it comes out the same for everyone (exact paper size, landscape,
// vector text), instead of depending on each person's browser and PDF printer.
const MAX_BODY = 2 * 1024 * 1024;
const Body = z.object({
  schedule: z.object({ title: z.string().max(500).optional(), tasks: z.array(z.object({}).passthrough()).max(500) }).passthrough(),
  paper: z.enum(["letter", "tabloid"]),
  showToday: z.boolean(),
  showLegend: z.boolean(),
  filename: z.string().max(200).default("Schedule"),
});

export async function POST(request: Request): Promise<Response> {
  try {
    checkAccess(request);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new UserFacingError("That schedule is too large to print.", 413);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new UserFacingError("Invalid PDF request.");
    const { schedule, paper, showToday, showLegend, filename } = parsed.data;
    const pdf = await schedulePdf({
      origin: appOrigin(request),
      accessCode: request.headers.get("x-access-code") ?? "",
      schedule,
      paper: paper as Paper,
      showToday,
      showLegend,
    });
    const safeName = filename.replace(/[^\w .()-]+/g, "_").slice(0, 120) || "Schedule";
    return new Response(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${safeName}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[schedule-pdf]", (err as Error).message);
    return errorResponse(err);
  }
}
