import { esc } from "./table";

// Open Calls: RFPs and design selections currently advertised by the sources below.
// Calls aren't collected yet; the page is laid out so they can be filled in once requests to the sources are built.

export type Source = { code: string; name: string; scope: string; url: string };

export const SOURCES: Source[] = [
  {
    code: "RACW",
    name: "Redevelopment Authority of the County of Washington",
    scope: "Washington County, PA. Community redevelopment and land bank RFPs.",
    url: "https://racw.net/rfps-request-for-proposals/",
  },
  {
    code: "PSU OPP",
    name: "Penn State Office of Physical Plant",
    scope: "Penn State University. Architect/engineer and design-build selection.",
    url: "https://www.opp.psu.edu/architectengineer-and-designbuild-selection",
  },
  {
    code: "PPS",
    name: "Pittsburgh Public Schools",
    scope: "Pittsburgh School District. Bids, proposals and RFQs.",
    url: "https://www.pghschools.org/community/business-opportunities/rfps",
  },
  {
    code: "PA DGS",
    name: "Pennsylvania Department of General Services",
    scope: "Commonwealth of PA. Currently advertised design professional selections.",
    url: "https://www.pa.gov/agencies/dgs/real-estate-construction-facilities/design-and-construction-info/design",
  },
  {
    code: "WCPA",
    name: "Washington County, PA",
    scope: "Washington County government. Purchasing bids and RFPs.",
    url: "https://www.washingtoncopa.gov/purchasing/bids",
  },
];

/** One advertised opportunity, as it will come from a source. */
export type OpenCall = {
  source: Source["code"];
  issuer: string;
  title: string;
  /** "YYYY-MM-DD", or "" when the listing doesn't give one */
  due: string;
  url: string;
};

// Filled in once requests to the sources exist.
const calls: OpenCall[] = [];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dueText = (due: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  return m ? `Due ${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "Due date not listed";
};
const external = (url: string, text: string) => `<a class="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function showCalls() {
  // Soonest deadline first; calls without a due date last.
  const sorted = [...calls].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  document.getElementById("calls-page")!.innerHTML = `
    <h2 class="group">Open calls</h2>
    ${
      sorted.length
        ? `<div class="cards">${sorted
            .map(
              (c) => `<div class="card call">
                <p class="call-issuer">${esc(c.issuer)}</p>
                <h3>${esc(c.title)}</h3>
                <div class="card-body"><p>${esc(dueText(c.due))}</p></div>
                <div class="card-actions">${external(c.url, "View listing")}</div>
              </div>`,
            )
            .join("")}</div>`
        : `<p class="none">None collected yet. Until then, check the sources below.</p>`
    }

    <h2 class="group">Sources</h2>
    <div class="cards sources">${SOURCES.map(
      (s) => `<div class="card source">
        <p class="source-code">${esc(s.code)}</p>
        <h3>${esc(s.name)}</h3>
        <div class="card-body"><p>${esc(s.scope)}</p></div>
        <div class="card-actions">${external(s.url, "Open site")}</div>
      </div>`,
    ).join("")}</div>`;
}
