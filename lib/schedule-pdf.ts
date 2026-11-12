import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { UserFacingError } from "./claude.js";

// Schedule PDFs made on the server: a headless Chrome opens the app's own print page for the schedule and saves it
// as a vector PDF at the exact paper size and orientation, on one page. The same file for everyone, whatever their browser or PDF
// printer (some, like Bluebeam's, override the page size and orientation when printing from a browser).

export type Paper = "letter" | "tabloid";
// Sheet size in CSS pixels (96 per inch): 8.5 × 11 portrait, 11 × 17 landscape.
const SHEET: Record<Paper, { width: number; height: number }> = {
  letter: { width: 816, height: 1056 },
  tabloid: { width: 1632, height: 1056 },
};
// The only other hosts the print page may load: the web fonts it uses.
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/**
 * The app's own address, which the browser is allowed to open. On Vercel it comes from Vercel's settings, never from
 * the request, so a forged Host header can't point the server's browser at another site.
 */
export function appOrigin(request: Request): string {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // Local development: the dev server on this machine only.
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new UserFacingError("PDFs can't be made from this address.", 400);
  return `http://${host}`;
}

export async function schedulePdf(opts: {
  origin: string;
  accessCode: string;
  schedule: unknown;
  paper: Paper;
  showToday: boolean;
  showLegend: boolean;
}): Promise<Uint8Array> {
  const sheet = SHEET[opts.paper];
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { ...sheet, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    const own = new URL(opts.origin).host;
    // Anything that isn't this app or its fonts is refused.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.protocol === "data:" || url.protocol === "blob:" || url.host === own || FONT_HOSTS.has(url.host)) req.continue();
      else req.abort();
    });
    // The print page reads the schedule from session storage, and the app asks for the access code before it opens.
    await page.evaluateOnNewDocument(
      (schedule: string, code: string) => {
        sessionStorage.setItem("r3a_preview", schedule);
        localStorage.setItem("access-code", code);
      },
      JSON.stringify(opts.schedule),
      opts.accessCode,
    );
    const params = new URLSearchParams({ paper: opts.paper, today: opts.showToday ? "1" : "0", legend: opts.showLegend ? "1" : "0", pdf: "1" });
    await page.goto(`${opts.origin}/#schedule-print?${params}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector(".preview-pg", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    // The print page scales itself to fit one page once it has measured; wait for that.
    await page.waitForSelector('[data-fitted="1"]', { timeout: 15_000 });
    await page.emulateMediaType("print");
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 30_000 });
  } finally {
    await browser.close();
  }
}
