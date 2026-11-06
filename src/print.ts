// Sets the page title while printing, which browsers use as the default PDF file name:
// "20261106_RFP-Review_Riverside-Branch-Library-Renovation".

const MAX_NAME = 60;
let provider: (() => { kind: string; name: string } | null | undefined) | null = null;

/** The active tab registers what's on screen to print (null when nothing is open). */
export const setPrintName = (fn: () => { kind: string; name: string } | null | undefined) => (provider = fn);

/**
 * "20261106_RFP-Review_Riverside-Branch-Library-Renovation": date, document type, project. Underscores separate
 * the parts and hyphens join words, with no spaces or punctuation, so the name is safe in links, email and any
 * file system. Long project names are cut at a whole word.
 */
export function fileName(kind: string, name: string, now = new Date()): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const slug = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // accents: "Café" -> "Cafe"
      .replace(/&/g, " and ")
      .replace(/['’]/g, "") // "Owner's" -> "Owners"
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  let project = slug(name);
  if (project.length > MAX_NAME) {
    const cut = project.slice(0, MAX_NAME + 1);
    const at = cut.lastIndexOf("-");
    project = at > MAX_NAME * 0.6 ? cut.slice(0, at) : cut.slice(0, MAX_NAME).replace(/-+$/, "");
  }
  return [date, slug(kind), project].filter(Boolean).join("_");
}

let saved: string | null = null;
addEventListener("beforeprint", () => {
  const doc = provider?.();
  if (!doc) return;
  saved = document.title;
  document.title = fileName(doc.kind, doc.name);
});
addEventListener("afterprint", () => {
  if (saved != null) document.title = saved;
  saved = null;
});
