// One page of a kept RFP PDF, shown in the app: the same for everyone, whatever their browser's PDF viewer or default
// PDF app (which may ignore "#page=" and open at page 1). pdf.js is loaded only when a page is first opened, and reads
// only the parts of the file it needs (range requests) where storage allows. The legacy build works in browsers a few
// versions old too (the main build needs the very latest).
import { esc } from "./table";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  lib ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  });
  return lib;
}

/** Shows `page` of the PDF at `url` (a short-lived signed link), with previous / next and a link to the whole file. */
export async function showPdfPage(url: string, page: number, title: string): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.className = "modal pdf-page";
  dialog.innerHTML = `
    <div class="pdf-page-bar">
      <h2>${esc(title)}</h2>
      <span class="pdf-page-nav">
        <button class="link" data-step="-1" aria-label="Previous page">‹</button>
        <span data-at>page ${page}</span>
        <button class="link" data-step="1" aria-label="Next page">›</button>
      </span>
      <a class="link" href="${esc(`${url}#page=${page}`)}" target="_blank" rel="noopener" data-full>Open full PDF</a>
      <button class="link" data-close>Close</button>
    </div>
    <div class="pdf-page-body"><p class="note" data-status>Loading page ${page}…</p><canvas hidden></canvas></div>`;
  document.body.appendChild(dialog);
  dialog.showModal();

  const canvas = dialog.querySelector("canvas")!;
  const status = dialog.querySelector<HTMLElement>("[data-status]")!;
  const at = dialog.querySelector<HTMLElement>("[data-at]")!;
  const full = dialog.querySelector<HTMLAnchorElement>("[data-full]")!;
  let doc: Awaited<ReturnType<PdfJs["getDocument"]>["promise"]> | null = null;
  let task: ReturnType<PdfJs["getDocument"]> | null = null;
  let current = page;
  let rendering: { cancel(): void } | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    rendering?.cancel();
    void task?.destroy();
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", (e) => (e.preventDefault(), close()));
  dialog.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (e.target === dialog || t.closest("[data-close]")) return close();
    const step = t.closest("[data-step]")?.getAttribute("data-step");
    if (step && doc) void show(current + Number(step));
  });
  dialog.addEventListener("keydown", (e) => {
    if (!doc || (e.target as HTMLElement).closest("a, input")) return;
    if (e.key === "ArrowLeft") void show(current - 1);
    if (e.key === "ArrowRight") void show(current + 1);
  });

  async function show(n: number) {
    if (!doc || n < 1 || n > doc.numPages) return;
    current = n;
    at.textContent = `page ${n} of ${doc.numPages}`;
    full.href = `${url}#page=${n}`;
    rendering?.cancel();
    const p = await doc.getPage(n);
    if (closed || current !== n) return;
    // Fit the page to the dialog's width, sharp on high-density screens.
    const width = Math.min(dialog.querySelector<HTMLElement>(".pdf-page-body")!.clientWidth || 800, 900);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: width / base.width });
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    const r = p.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    rendering = r;
    try {
      await r.promise;
      status.hidden = true;
      canvas.hidden = false;
    } catch (err) {
      if ((err as Error).name !== "RenderingCancelledException") throw err;
    }
  }

  try {
    const m = await pdfjs();
    if (closed) return;
    task = m.getDocument({
      url,
      wasmUrl: "/pdfjs/wasm/",
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      disableAutoFetch: true, // fetch only the pages shown
      enableXfa: false,
    });
    doc = await task.promise;
    if (closed) return;
    await show(Math.min(Math.max(page, 1), doc.numPages));
  } catch (err) {
    if (closed) return;
    status.hidden = false;
    status.textContent = `Couldn't show the page (${(err as Error).message}). Use "Open full PDF" instead.`;
  }
}
