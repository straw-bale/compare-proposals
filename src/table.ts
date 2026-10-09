import type { Comparison, Proposal } from "../lib/claude";

type FeeItem = Proposal["fee_items"][number];
/** A proposal plus the uploaded file it came from and its Anthropic file id (both added client-side). */
export type Sourced = Proposal & { source_file?: string; file_id?: string; pdf_tokens?: number; source_hash?: string };

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "—");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Shows every proposal date the same way ("Oct 2, 2026"). Only full dates (year, month, day) are
 * reformatted; anything partial or vague ("Fall 2026") is left exactly as written.
 */
function fmtDate(d: string): string {
  let y: number, m: number, day: number;
  let r: RegExpMatchArray | null;
  if ((r = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, day] = [+r[1], +r[2], +r[3]];
  else if ((r = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [y, m, day] = [+r[3], +r[1], +r[2]];
  else if ((r = d.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && MONTHS.includes(r[1].toLowerCase()))
    [y, m, day] = [+r[3], MONTHS.indexOf(r[1].toLowerCase()) + 1, +r[2]];
  else return d;
  const date = new Date(y, m - 1, day);
  if (date.getMonth() !== m - 1 || date.getDate() !== day) return d; // reject impossible dates like 2/30
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const source = (p: Sourced) => (p.source_file ? `<small class="src">${esc(p.source_file)}</small>` : "");

function head(proposals: Sourced[]) {
  return `<colgroup><col class="rowhead">${proposals.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${proposals
    .map((p) => `<th>${esc(p.firm)}${p.proposal_date ? `<small>${esc(fmtDate(p.proposal_date))}</small>` : ""}${source(p)}</th>`)
    .join("")}</tr></thead>`;
}

/** Renders a fee line exactly as stated: dollars, or a percentage of construction. Nothing is computed. */
function feeValue(f: FeeItem): string {
  if (f.amount != null) return money(f.amount);
  if (f.percent != null) return `${f.percent}%${f.basis === "percent_of_construction" ? " of construction" : ""}`;
  return "Not stated";
}

const BASIS: Partial<Record<FeeItem["basis"], string>> = { not_to_exceed: "NTE", hourly: "hourly", allowance: "allowance" };

// Model notes are words only; drop any that carry figures so no unstated number is shown.
const cleanNote = (n: string | null) => (n && !/[$%]|d/.test(n) ? n : null);

type Cell = { items: FeeItem[]; note: string | null };
type FeeRow = { section: string; label: string; cells: Cell[] };
const ALL = "__all__";

/**
 * Groups fee rows under scenario headings (e.g. construction-budget ranges). Scenario membership comes from
 * each fee line itself, so a row the model mixed across scenarios is split into one row per scenario.
 */
function groupByScenario(proposals: Sourced[], cmp: Comparison) {
  const scenarioOf = (firm: number, f: FeeItem) => {
    if (f.scenario == null) return ALL;
    const s = cmp.scenarios.find((s) => s.firm_labels.some((l) => l.firm_index === firm && l.scenario === f.scenario));
    return s?.name ?? f.scenario; // unmapped: keep the firm's own wording rather than guess a match
  };
  const groups = new Map<string, FeeRow[]>([[ALL, []], ...cmp.scenarios.map((s) => [s.name, []] as [string, FeeRow[]])]);

  for (const r of cmp.fee_rows) {
    const buckets = new Map<string, Cell[]>();
    proposals.forEach((p, i) => {
      const cell = r.cells.find((c) => c.firm_index === i);
      const items = (cell?.item_ids ?? []).map((id) => p.fee_items.find((f) => f.id === id)).filter((f): f is FeeItem => !!f);
      let noted = false;
      for (const f of items) {
        const key = scenarioOf(i, f);
        if (!buckets.has(key)) buckets.set(key, proposals.map(() => ({ items: [], note: null })));
        const c = buckets.get(key)![i];
        c.items.push(f);
        if (!noted) [c.note, noted] = [cleanNote(cell?.note ?? null), true];
      }
    });
    for (const [key, cells] of buckets) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ section: r.section, label: r.label, cells });
    }
  }
  return [...groups].filter(([, rows]) => rows.length);
}

export function feeTable(proposals: Sourced[], cmp: Comparison): string {
  const span = proposals.length + 1;
  const row = (label: string, cells: string[], cls = "") =>
    `<tr class="${cls}"><th scope="row">${esc(label)}</th>${cells.join("")}</tr>`;
  const section = (name: string) => `<tr class="cat"><th colspan="${span}">${esc(name)}</th></tr>`;
  const scenarioHead = (title: string, sub: string) =>
    `<tr class="scenario"><th colspan="${span}">${esc(title)}<span class="sub">${esc(sub)}</span></th></tr>`;

  const groups = groupByScenario(proposals, cmp);
  const hasScenarios = groups.some(([key]) => key !== ALL);
  const rows: string[] = [];

  for (const [key, feeRows] of groups) {
    if (hasScenarios) {
      rows.push(
        key === ALL
          ? scenarioHead("All scenarios", "Fees that don't depend on the scenario")
          : scenarioHead(`Scenario: ${key}`, "Fees priced for this scenario only"),
      );
    }
    let current = "";
    for (const r of feeRows) {
      if (r.section !== current) rows.push(section((current = r.section)));

      // Highlight the lowest only when every firm has exactly one stated dollar figure of the same kind.
      const singles = r.cells.map((c) => (c.items.length === 1 && c.items[0].amount != null ? c.items[0] : null));
      const comparable = singles.every((f) => f && f.kind === singles[0]!.kind) && proposals.length > 1;
      const low = comparable ? Math.min(...singles.map((f) => f!.amount!)) : null;
      const isTotal = r.cells.some((c) => c.items.some((f) => f.kind === "total" || f.kind === "subtotal"));

      rows.push(
        row(
          r.label,
          r.cells.map(({ items, note }) => {
            if (!items.length) return "<td>—</td>";
            const lines = items
              .map((f) => {
                const tag = BASIS[f.basis];
                const sub = [items.length > 1 || f.label !== r.label ? f.label : "", tag, f.page ? `p. ${f.page}` : ""]
                  .filter(Boolean)
                  .join(" · ");
                return `<div>${feeValue(f)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>`;
              })
              .join("");
            const lowCls = low != null && items[0].amount === low ? " low" : "";
            return `<td class="num${lowCls}">${lines}${note ? `<span class="sub">${esc(note)}</span>` : ""}</td>`;
          }),
          isTotal ? "total" : "",
        ),
      );
    }
  }

  rows.push(section("Terms"));
  rows.push(row("Fee structure", proposals.map((p) => `<td>${esc(p.fee_structure ?? "—")}</td>`)));
  rows.push(
    row(
      "Additional services",
      proposals.map(
        (p) =>
          `<td>${list(
            p.additional_services.map((a) =>
              [a.description, a.amount != null ? money(a.amount) : a.basis].filter(Boolean).join(" — "),
            ),
          )}</td>`,
      ),
    ),
  );
  rows.push(row("Reimbursables", proposals.map((p) => `<td>${esc(p.reimbursables ?? "—")}</td>`)));
  rows.push(
    row(
      "Hourly rates",
      proposals.map(
        (p) => `<td>${list(p.hourly_rates.map((r) => `${r.role}: ${r.rate != null ? money(r.rate) + "/hr" : "—"}`))}</td>`,
      ),
    ),
  );
  rows.push(row("CA site visits", proposals.map((p) => `<td>${esc(p.ca_site_visits ?? "—")}</td>`)));
  rows.push(row("Schedule", proposals.map((p) => `<td>${esc(p.schedule ?? "—")}</td>`)));
  rows.push(row("Payment terms", proposals.map((p) => `<td>${esc(p.payment_terms ?? "—")}</td>`)));
  rows.push(row("Disciplines", proposals.map((p) => `<td>${esc(p.disciplines.join(", ") || "—")}</td>`)));

  return head(proposals) + `<tbody>${rows.join("")}</tbody>`;
}

const STATUS = { included: "Included", optional: "Optional", excluded: "Excluded", not_mentioned: "Not mentioned" } as const;

export function scopeTable(proposals: Sourced[], cmp: Comparison): string {
  const body = cmp.categories
    .map((cat) => {
      const items = cat.items
        .map((it) => {
          const cells = proposals.map((_, i) => it.statuses.find((s) => s.firm_index === i));
          const kinds = new Set(cells.map((c) => c?.status ?? "not_mentioned"));
          const cls = kinds.size > 1 ? "diff" : "same";
          return `<tr class="${cls}"><th scope="row">${esc(it.item)}</th>${cells
            .map((c) => {
              const st = c?.status ?? "not_mentioned";
              const title = [c?.note, c?.page ? `p. ${c.page}` : ""].filter(Boolean).join(" · ");
              return `<td class="st st-${st}" title="${esc(title)}">${STATUS[st]}${
                c?.note ? `<span class="sub">${esc(c.note)}</span>` : ""
              }</td>`;
            })
            .join("")}</tr>`;
        })
        .join("");
      // Category header row hides with diff-only when all its items are "same".
      const allSame = cat.items.every((it) => {
        const kinds = new Set(proposals.map((_, i) => it.statuses.find((s) => s.firm_index === i)?.status ?? "not_mentioned"));
        return kinds.size <= 1;
      });
      return `<tr class="cat ${allSame ? "same" : ""}"><th colspan="${proposals.length + 1}">${esc(cat.name)}</th></tr>${items}`;
    })
    .join("");
  return head(proposals) + `<tbody>${body}</tbody>`;
}

export function notesHtml(proposals: Sourced[]): string {
  return proposals
    .map((p) => {
      const sec = (title: string, items: string[]) => (items.length ? `<h4>${title}</h4>${list(items)}` : "");
      return `<div><h3>${esc(p.firm)}${source(p)}</h3>${sec("Exclusions", p.exclusions)}${sec(
        "Assumptions",
        p.assumptions,
      )}${sec("Clarifications", p.clarifications)}${sec("Deliverables", p.deliverables)}${sec(
        "Extraction notes",
        p.extraction_notes,
      )}</div>`;
    })
    .join("");
}

const LEVEL = { high: "Act", medium: "Clarify", low: "Note" } as const;

export function briefingHtml(proposals: Proposal[], cmp: Comparison): string {
  const b = cmp.briefing;
  const names = (ix: number[]) => ix.map((i) => proposals[i]?.firm).filter(Boolean).join(", ");
  const flags = b.flags
    .map(
      (f) => `<li class="lv-${f.level}"><span class="lv">${LEVEL[f.level]}</span><div><b>${esc(f.title)}</b>${
        f.firm_indexes.length ? ` <span class="who">${esc(names(f.firm_indexes))}</span>` : ""
      }<p>${esc(f.detail)}</p></div></li>`,
    )
    .join("");
  const questions = b.questions
    .filter((q) => q.items.length && proposals[q.firm_index])
    .map((q) => `<div><h4>${esc(proposals[q.firm_index].firm)}</h4>${list(q.items)}</div>`)
    .join("");
  return `<p class="headline">${esc(b.headline)}</p>
    <p class="overview">${esc(b.overview)}</p>
    ${flags ? `<h3 class="label">Flags</h3><ol class="flags">${flags}</ol>` : ""}
    ${questions ? `<h3 class="label">Questions to send</h3><div class="questions">${questions}</div>` : ""}`;
}
