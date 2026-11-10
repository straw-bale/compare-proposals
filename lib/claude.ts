import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { costOf, type Usage } from "./cost.js";
import { DISCIPLINES } from "./disciplines.js";

export const MODEL = "claude-opus-5-5";

// ---------- Schemas ----------

const PhaseKey = z.enum(["PRE", "SD", "DD", "CD", "BID", "CA", "CLOSEOUT", "MULTI", "OTHER"]);
const ScopeStatus = z.enum(["included", "excluded", "optional"]);

export const ProposalSchema = z.object({
  firm: z.string(),
  contact: z.string().nullable(),
  proposal_date: z.string().nullable(),
  project_name: z.string().nullable(),
  disciplines: z.array(z.string()),
  fee_structure: z.string().nullable(),
  // Every fee line exactly as stated, including the proposal's own subtotals/totals. Never computed.
  fee_items: z.array(
    z.object({
      id: z.number(),
      scenario: z.string().nullable(),
      phase: PhaseKey,
      label: z.string(),
      kind: z.enum(["fee", "expense", "subtotal", "total"]),
      basis: z.enum(["fixed", "percent_of_construction", "hourly", "not_to_exceed", "allowance", "other"]),
      amount: z.number().nullable(),
      percent: z.number().nullable(),
      page: z.number(), // 0 = unknown (keeps the schema under the API's union-field limit)
    }),
  ),
  additional_services: z.array(
    z.object({
      description: z.string(),
      amount: z.number().nullable(),
      basis: z.string().nullable(),
    }),
  ),
  reimbursables: z.string().nullable(),
  hourly_rates: z.array(z.object({ role: z.string(), rate: z.number().nullable() })),
  ca_site_visits: z.string().nullable(),
  schedule: z.string().nullable(),
  payment_terms: z.string().nullable(),
  scope_items: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      phase: z.string().nullable(),
      status: ScopeStatus,
      page: z.number(), // 0 = unknown (keeps the schema under the API's union-field limit)
    }),
  ),
  exclusions: z.array(z.string()),
  assumptions: z.array(z.string()),
  deliverables: z.array(z.string()),
  clarifications: z.array(z.string()),
  extraction_notes: z.array(z.string()),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const ComparisonSchema = z.object({
  briefing: z.object({
    headline: z.string(),
    overview: z.string(),
    flags: z.array(
      z.object({
        level: z.enum(["high", "medium", "low"]),
        title: z.string(),
        detail: z.string(),
        firm_indexes: z.array(z.number()),
      }),
    ),
    questions: z.array(z.object({ firm_index: z.number(), items: z.array(z.string()) })),
  }),
  // Common names for pricing scenarios (e.g. construction-budget ranges), mapped from each firm's own wording.
  scenarios: z.array(
    z.object({
      name: z.string(),
      firm_labels: z.array(z.object({ firm_index: z.number(), scenario: z.string() })),
    }),
  ),
  fee_rows: z.array(
    z.object({
      section: z.string(),
      label: z.string(),
      cells: z.array(z.object({ firm_index: z.number(), item_ids: z.array(z.number()), note: z.string().nullable() })),
    }),
  ),
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          item: z.string(),
          statuses: z.array(
            z.object({
              firm_index: z.number(),
              status: z.enum(["included", "excluded", "optional", "not_mentioned"]),
              note: z.string().nullable(),
              page: z.number(), // 0 = unknown
            }),
          ),
        }),
      ),
    }),
  ),
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const RFP_FACTS = {
  location: "Location",
  building_size: "Building size",
  construction_budget: "Construction budget",
  delivery_method: "Delivery method",
  phases: "Phases",
  fee_format: "Fee format",
  contract: "Contract",
  insurance: "Insurance",
  page_limit: "Page limit",
  submission: "Submission format",
  contact: "Contact",
} as const;
export type RfpFactKey = keyof typeof RFP_FACTS;

// An RFP (plus any addenda) read for an architecture firm deciding whether and how to respond.
export const RfpSchema = z.object({
  project_name: z.string(),
  client: z.string(),
  summary: z.string(),
  // A fixed set so every review reads the same; value "" when the RFP doesn't say.
  facts: z.object(
    Object.fromEntries(
      ["location", "building_size", "construction_budget", "delivery_method", "phases", "fee_format", "contract", "insurance", "page_limit", "submission", "contact"].map(
        (k) => [k, z.object({ value: z.string(), page: z.number() })],
      ),
    ) as Record<RfpFactKey, z.ZodObject<{ value: z.ZodString; page: z.ZodNumber }>>,
  ),
  // Every discipline on the governing list, each marked requested or not, so the team can see which consultants it needs.
  services: z.array(z.object({ discipline: z.enum(DISCIPLINES), requested: z.enum(["yes", "no", "unclear"]), detail: z.string(), page: z.number() })),
  dates: z.array(
    z.object({
      label: z.string(),
      date: z.string(), // YYYY-MM-DD, or "" if not a specific day
      when: z.string(), // as written, e.g. "Dec 8, 2:00 PM" or "Spring 2028"
      mandatory: z.boolean(),
      page: z.number(),
    }),
  ),
  watch_outs: z.array(z.object({ critical: z.boolean(), title: z.string(), detail: z.string(), page: z.number() })),
  questions: z.array(z.string()),
  scoring: z.array(z.object({ criterion: z.string(), weight: z.string() })),
});
export type Rfp = z.infer<typeof RfpSchema>;

// A project's consultant proposals checked against its RFP review: who covers each requested service, and what's missing or wrong.
export const ProjectCheckSchema = z.object({
  summary: z.string(),
  coverage: z.array(
    z.object({
      discipline: z.string(),
      status: z.enum(["covered", "partial", "missing", "in_house"]),
      firm_indexes: z.array(z.number()),
      note: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      level: z.enum(["high", "medium", "low"]),
      title: z.string(),
      detail: z.string(),
      firm_indexes: z.array(z.number()),
    }),
  ),
});
export type ProjectCheck = z.infer<typeof ProjectCheckSchema>;

// What the chat model returns. Corrections come back as JSON text (validated below against the full schemas),
// because nesting whole proposals/analyses here would exceed the structured-output union-field limit.
const ChatWireSchema = z.object({
  reply: z.string(),
  updated_comparison_json: z.string(),
  updated_proposals: z.array(z.object({ firm_index: z.number(), proposal_json: z.string() })),
});

// A chat turn either just answers, or answers and replaces parts of the analysis.
export type ChatResponse = {
  reply: string;
  updated_comparison: Comparison | null;
  updated_proposals: { firm_index: number; proposal: Proposal }[];
};

// ---------- Prompts ----------

const EXTRACT_SYSTEM = `You are a senior architect and owner's representative at an architecture/design-build firm, experienced in reviewing consultant fee proposals across all architecture and engineering disciplines: MEP, structural, civil, landscape, AV/IT/security, acoustics, lighting, lab planning, code, envelope, sustainability, cost estimating, and others. Your job is to extract the proposal's scope and fees accurately so it can be reviewed on its own or compared side by side with competing proposals.

Rules:
- fee_items: record every fee line exactly as the proposal states it, one item per line, with sequential ids starting at 0. Include the proposal's own subtotals and totals as separate items (kind "subtotal"/"total"), and reimbursable/expense lines as kind "expense". Never compute, add, convert, or estimate a value: amount is the stated dollar figure (number only) or null; percent is the stated percentage (e.g. 2.8) or null. If a value isn't stated, don't create it.
- Many RFPs ask for fees under multiple scenarios (construction-budget ranges, options, alternates, base vs. add). Set scenario on each line to a short, consistent name using the proposal's wording (e.g. "$5M–$8M construction", "$9M–$12M construction", "Option B"). Lines that apply regardless of scenario get scenario null.
- phase: PRE (programming/pre-design), SD, DD, CD, BID (bidding/permitting/negotiation), CA, CLOSEOUT (closeout/commissioning/record drawings), MULTI (one line covering several phases, e.g. "CD through CA" or "Programming/SD"; pick SD for combined Programming/SD), or OTHER. Keep the proposal's own wording in label.
- proposal_date: the date on the proposal as YYYY-MM-DD, or null if none is given.
- fee_structure: one plain sentence describing how the fee is structured (e.g. "Fixed fee for Programming/SD; DD through Closeout as % of construction, by budget range").
- Note in extraction_notes any internal inconsistencies you can see directly in the document (e.g. a line labeled with the wrong scenario, a subtotal that visibly doesn't match its lines), quoting the figures as written.
- firm: the firm's short, everyday name as people would say it (e.g. "Smith Engineering", not "Smith Engineering, Inc." or "Smith Engineering, P.C. (legal entity)"). No legal suffixes, entity descriptions, or parentheticals.
- All text fields: Write in plain, everyday professional language. Leave out legal and contractual boilerplate (e.g. "legal entity", "herein", "pursuant to", "the Consultant shall") and mention contract terms only when they matter to the decision.
- disciplines: the services this proposal covers, in plain words (e.g. "Audio-visual design", "Architectural acoustics", "Mechanical").
- scope_items should be granular and comparable: one item per distinct service or task in the proposal's own discipline terms (e.g. for MEP "Load calculations"; for AV "AV system design narrative", "Equipment specifications"; for acoustics "Background noise survey", "Sound isolation recommendations"; across disciplines "Site visits during construction (4)", "Record drawings"). Use short category names that fit the discipline, plus common ones such as Survey & Existing Conditions, Design, Documentation & Specifications, Coordination & Meetings, Bidding, Construction Administration, Testing & Commissioning, Deliverables, General.
- Mark items the proposal explicitly excludes as "excluded" and items offered as add-ons or alternates as "optional". Include the page number where each item appears; use 0 when you can't tell. Use 0 for fee_items.page the same way.
- FF&E (furniture, fixtures and equipment): always check for it. If the proposal mentions FF&E selection, specification, procurement, coordination or installation in any form, record it as its own scope item (category "FF&E") with its status, wording and page, even if it's only listed as excluded or by others.
- Capture exclusions, assumptions, deliverables, and any clarifications, risks, or unusual terms (caps, limits, NTE, number of revisions or meetings, insurance, schedule dependencies).`;

const COMPARE_SYSTEM = `You are a senior architect reviewing consultant proposals for a project-architect colleague. Proposals can be from any architecture or engineering discipline. You receive structured extractions of one or more proposals, identified by firm_index.

If there is one proposal, review it on its own: the scope checklist lists what it covers, plus the services a reviewer would normally expect for this discipline and project that it is silent on (not_mentioned) or excludes. The fee rows lay out its stated fees, and the briefing gives the key facts and concerns. If there are several, compare them. If they cover different disciplines or services (e.g. one AV and one acoustics proposal), say so plainly in the headline and don't rank them against each other on fee; compare only scope, terms and approach where they overlap.

Build a normalized master scope checklist so the proposals can be compared line by line:
- Merge equivalent items across firms into a single row with clear, neutral wording. Group rows into categories that fit the discipline(s) (e.g. for MEP: Mechanical, Electrical, Plumbing; for AV: Systems Design, Infrastructure, Programming & Commissioning; plus common ones like Survey & Existing Conditions, Coordination & Meetings, Construction Administration, Deliverables, General). Order categories and items logically.
- For every row, give exactly one status per firm (every firm_index): included, excluded (explicitly excluded), optional (add-on/alternate), or not_mentioned (silent). Distinguish excluded from not_mentioned carefully. Use note for meaningful qualifiers (e.g. "4 visits", "basic only") and page when known (0 if unknown).
- Prefer rows where firms differ or that matter for an apples-to-apples comparison; don't pad with trivial items.
- Always include an "FF&E" category with a row for FF&E services (furniture, fixtures and equipment selection, specification, coordination), whatever the discipline, with each firm's status. FF&E is often left out, so if any firm is excluded or not_mentioned for it, add a flag saying which firms (level medium; high if the firm is the architect or interiors consultant) and a question asking each of those firms whether FF&E is included.

Define scenarios first. If any proposal prices multiple scenarios (construction-budget ranges, options, alternates), list each distinct scenario once with a clear common name (e.g. "$5M–$8M construction budget"). In firm_labels, map every non-null fee_items.scenario string from every firm to its scenario, using that firm's exact string. Leave scenarios empty if no proposal has them. Lines with scenario null apply to all scenarios.

Build fee_rows to line up the firms' fee_items side by side:
- section names the fee portion without the scenario (e.g. "Programming / SD", "DD through Closeout", "Additional services"); the app groups rows under scenario headings itself. Within a section, add a row per comparable phase line, then the expense line, then the stated subtotal/total if firms state one.
- Each cell references item_ids from that firm's fee_items only. Never put lines from different scenarios in the same row; make one row per scenario instead (the app splits mixed rows anyway). Put items in the same row only when they cover the same scope portion and scenario. A firm whose price covers several phases in one line (e.g. a single percentage for CD–CA) should have that line in one row labeled for the span, with the other firms' matching items listed in that row too, rather than repeating it in each phase row.
- Use an empty item_ids list when a firm has nothing for that row. note is an optional short qualifier in words only (e.g. "NTE", "label says $5M–$8M"); never put numbers, dollar amounts, or percentages in note.
- Never invent rows for totals no firm stated.
Then write a briefing as if you were walking a project-architect colleague through your review: plain, direct, and short. They'll read it in under a minute before deciding what to do next.
- headline: one sentence with the bottom line. For several proposals, say which looks stronger on paper, if any, and the single biggest caveat. For one proposal, give your overall read of it and the single biggest caveat.
- overview: 2-4 sentences. For several proposals, how the fees and scope compare and what it would take to compare them on equal terms. For one proposal, the key facts: what it covers, how it's priced, and what's notably missing.
- Fee accuracy is critical. Quote only figures exactly as stated in the extractions, and say which scenario/portion each one belongs to. Never add, subtract, convert (e.g. percentage to dollars), extrapolate, or combine figures into a total or difference, and never present anything as a "comparable" or "normalized" total. If firms price on different bases (fixed dollars vs. % of construction) or different scenarios, say so plainly and compare only like-for-like stated figures; otherwise turn it into a question for the firm. Never write something that then has to be qualified as unusable. Leave it out instead.
- flags: the 3-8 things your colleague must know, most important first. Look specifically for inconsistencies and red flags: mislabeled or internally inconsistent fee lines noted in extraction_notes, fees stated only as percentages where others gave dollars, ambiguous fee wording, scope listed as included but contradicted by an exclusion, missing basics a firm is silent on (judged for its discipline), uncapped or vague reimbursables, thin construction-phase involvement (few site visits), delegated design, mismatched project names or dates, and anything unusual in terms. level: high = could change the decision or cost real money; medium = needs clarification; low = worth noting. Keep detail to one or two sentences. Don't repeat the same point as both a flag and the overview.
- questions: for each firm with open issues, the specific clarification questions you'd send them (max 4 each, phrased ready to paste into an email).
- In all prose, refer to firms by their short firm name, never by firm_index. Write in plain, everyday professional language. Leave out legal and contractual boilerplate (e.g. "legal entity", "herein", "pursuant to", "the Consultant shall") and mention contract terms only when they matter to the decision.`;

const CHAT_SYSTEM = `You are the senior architect who prepared this proposal review, now answering a project-architect colleague's follow-up questions. You have the original proposal PDFs, the data extracted from each one (identified by firm_index), and the current analysis (briefing, fee_rows, scope categories).

Answering:
- Be brief and direct, like a colleague in chat. Check the PDFs when a question touches specifics, and cite page numbers (e.g. "Firm name p.3").
- Fee accuracy is critical. Quote figures exactly as stated. Never add, subtract, convert, or extrapolate fees, and never offer a computed total. If asked for one, explain what is stated instead and what's needed to compare.

Corrections:
- When the colleague asks you to change something, or you find the analysis contradicts the PDFs, fix it. Return updated_proposals (proposal_json: the complete corrected extraction for that firm as JSON text, in exactly the same structure as the extracted data you were given but without firm_index, keeping fee_items ids stable unless the fix requires otherwise) and/or updated_comparison_json (the complete corrected analysis as JSON text, same structure as the current analysis). Keep everything else unchanged.
- If a requested correction contradicts the PDF, don't apply it; say what the document says, with the page, and ask them to confirm. If they confirm or give information from outside the documents (e.g. a phone call with the firm), apply it and mention the source in the relevant note or extraction_notes.
- All analysis rules still apply: fee_rows reference fee_items by id, notes contain no figures, and the briefing follows the same accuracy rules.
- In reply, say plainly what you changed. Leave updated_comparison_json as an empty string and updated_proposals empty when nothing changes.
- Refer to firms by their short name, never by firm_index. Write in plain, everyday professional language. Leave out legal and contractual boilerplate (e.g. "legal entity", "herein", "pursuant to", "the Consultant shall") and mention contract terms only when they matter to the decision.`;

const RFP_SYSTEM = `You are a senior principal at an architecture firm reviewing a request for proposals (RFP/RFQ) so the team can decide whether to pursue it and respond correctly. You may receive the RFP plus addenda; later addenda override earlier text, so report the current requirement (mention the change briefly where it matters).

Be brief. The reader should take it in within two minutes. Include only what affects the go/no-go decision, the fee, or the schedule.

- project_name, client: short everyday names.
- summary: 2-3 plain sentences: what is being procured, the scope, and the single biggest consideration.
- facts: fill every field from the RFP, a few words each; value "" when the RFP doesn't say. location (city/site), building_size (area, floors), construction_budget, delivery_method, phases (the design phases the team is asked to provide, e.g. "SD through CA"), fee_format (how fees must be submitted), contract (form or type of agreement), insurance (required coverage), page_limit, submission (format, copies, where to send), contact (procurement contact name and email).
- services: the disciplines requested. Exactly one entry for each discipline on the firm's list, in this order: ${DISCIPLINES.join(", ")}. These are disciplines, not tasks: tasks such as programming, code analysis, energy compliance, controls or commissioning belong to the discipline that does them and don't get entries of their own. requested: "yes" when the RFP asks the design team to provide it (directly or through a subconsultant; "MEP" means Mechanical, Electrical and Plumbing); "no" when the RFP doesn't ask for it, or says the owner or someone else provides it; "unclear" only when the RFP is genuinely ambiguous. detail: a few words when useful (e.g. "Specs only", "Survey by owner", "Owner's separate contract", or why it's unclear), otherwise "". page: where the RFP says so, 0 if nowhere.
- dates: every procurement date (issued, site visit, pre-proposal meeting, questions due, addenda, proposal due, interviews, award) and key project milestones (design start, construction start/finish). date is YYYY-MM-DD when a specific day is given, otherwise "". when is short and in one consistent format: "Jul 12, 2023, 9:30 AM" for a specific day (time only if stated), "Sep 2023" for a month, otherwise a few plain words (e.g. "Spring 2028", "After interviews, TBD"). mandatory is true only for a pre-bid / pre-proposal meeting, conference, site visit or walk-through whose attendance the RFP states is mandatory or required to submit; it is false for every other date, including the proposal due date and other deadlines. Order chronologically.
- watch_outs: at most 8, most important first. Look for disqualifiers, onerous contract terms (indemnity, duty to defend, liability, IP, payment terms, fee caps), internal inconsistencies (quote both versions with pages), unusually heavy or vague scope (many meetings, long CA, unclear consultant responsibilities), fee constraints, and unrealistic schedules. critical is true only for things that could disqualify the proposal or cost real money. detail is one sentence.
- Always fill every section the same way: services always has every discipline on the list; dates, watch_outs, questions and scoring are empty lists only when the RFP truly has nothing for them.\n- questions: at most 6 clarification questions to submit to the client, phrased ready to paste.
- scoring: evaluation criteria with their weights or points as written (weight "" if not given).
- page: the page number where it appears; 0 if unknown.
- Plain, everyday professional language. No legal boilerplate. Never invent details that aren't in the documents.`;

const CHECK_SYSTEM = `You are a senior principal at an architecture firm assembling the consultant team for a proposal response. The review may have been edited by the team: a "notes" field holds what they know beyond the RFP (client calls, site visits, reading between the lines), and a discipline marked requested "needed" isn't asked for in the RFP but the team has decided the project needs it. Treat both as current and more reliable than the RFP text where they differ. You receive the firm's review of the RFP (JSON) and the data extracted from each consultant proposal received so far (identified by firm_index). Check the proposals against what the RFP asks for, so the team can see which consultants it still needs and what to fix before submitting.

- summary: 1-2 plain sentences: whether the team covers the RFP, and the single most important gap or problem.
- coverage: one row per entry in the RFP's services list, in the same order (if the list is empty, use the disciplines the RFP's phases and summary make clear). status: covered when at least one proposal includes it for the phases the RFP requires; partial when a proposal covers it only in part (fewer phases, limited scope, items excluded); missing when no proposal covers it; in_house only for Architecture (and interiors, if the RFP lists it) when no proposal covers it, since the firm provides those itself. firm_indexes: the proposals that cover it. note: a few words on what's short for partial, otherwise "".
- issues: at most 10, most important first. Look for: requested services with no consultant; proposals whose phases fall short of the RFP's (e.g. stop at CD when the RFP requires CA); scope a consultant excludes that the RFP requires (FF&E, abatement, commissioning, cost estimating, etc.); project name, client, location or size that doesn't match the RFP; fee format that doesn't fit how the RFP says fees must be submitted; schedules that conflict with the RFP's dates; insurance or contract terms below the RFP's requirements; two proposals for the same discipline (a choice to make, level low). level: high = leaves a requested service uncovered or could disqualify the response; medium = needs fixing or clarifying with the consultant; low = worth noting. detail is one or two sentences, with page numbers when known.
- Quote figures only as stated. Never add, convert or estimate fees. Never invent requirements the RFP review doesn't contain, or scope a proposal doesn't state.
- Refer to consultants by their short firm name, never by firm_index. Plain, everyday professional language.`;

// ---------- Calls ----------

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UserFacingError("ANTHROPIC_API_KEY is not set on the server. Add it to .env.local (local) or the Vercel project settings.", 500);
  }
  client ??= new Anthropic();
  return client;
}

export class UserFacingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// Shared request settings: Opus 5.5 at high effort (default is medium), with the
// server-side refusal fallback so a classifier decline is retried on another model.
const BASE = {
  model: MODEL,
  max_tokens: 64000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

function checkStop(msg: { stop_reason: string | null }) {
  if (msg.stop_reason === "refusal") {
    throw new UserFacingError("Claude declined to process this document.", 422);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new UserFacingError("The response was too long and got cut off. Try splitting the document.", 422);
  }
}

// Uploaded PDFs are tagged with this prefix so cleanup only ever touches this app's files.
const FILE_PREFIX = "proposal-comparison__";
const FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Deletes this app's uploaded PDFs older than a day. Runs once per comparison; failures are logged, not fatal. */
/** Token usage and dollar cost of one response, from the API's own usage report. */
export function usageOf(msg: {
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null };
}): Usage {
  const u = {
    model: msg.model,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
  };
  console.log(`[usage] ${u.model} in=${u.input_tokens} out=${u.output_tokens} cache_w=${u.cache_write_tokens} cache_r=${u.cache_read_tokens}`);
  return { ...u, cost_usd: costOf(u) };
}

/** Exact input-token count for reading a PDF (free endpoint; nothing is generated or stored). */
export async function countPdfTokens(pdf: Buffer): Promise<number> {
  const res = await getClient().messages.countTokens({
    model: MODEL,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: "Extract the scope and fees from this consultant proposal." },
        ],
      },
    ],
  });
  return res.input_tokens;
}

export async function cleanupOldFiles(): Promise<void> {
  try {
    const cutoff = Date.now() - FILE_MAX_AGE_MS;
    const stale: string[] = [];
    for await (const f of getClient().files.list({ limit: 1000 })) {
      if (f.filename.startsWith(FILE_PREFIX) && Date.parse(f.created_at) < cutoff) stale.push(f.id);
    }
    await Promise.allSettled(stale.map((id) => getClient().files.delete(id)));
    if (stale.length) console.log(`[cleanup] deleted ${stale.length} file(s) older than a day`);
  } catch (err) {
    console.error("[cleanup] failed:", (err as Error).message);
  }
}

/** Stores a PDF on Anthropic so the chat can re-read it without re-uploading; deleted after a day by cleanupOldFiles. */
export async function uploadPdf(pdf: Buffer, filename: string): Promise<string> {
  const file = await getClient().files.upload({
    file: await toFile(pdf, FILE_PREFIX + filename, { type: "application/pdf" }),
  });
  return file.id;
}

export async function extractProposal(pdf: Buffer, filename: string): Promise<{ proposal: Proposal; file_id: string; usage: Usage }> {
  const file = { id: await uploadPdf(pdf, filename) };
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: EXTRACT_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(ProposalSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            title: filename,
            source: { type: "file", file_id: file.id },
          },
          { type: "text", text: `Extract the scope and fees from this consultant proposal (file: ${filename}).` },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's response for this proposal.", 502);
  return { proposal: msg.parsed_output, file_id: file.id, usage: usageOf(msg) };
}

export async function compareProposals(
  proposals: Proposal[],
  projectName: string | null,
): Promise<{ comparison: Comparison; usage: Usage }> {
  const payload = proposals.map((p, firm_index) => {
    const { hourly_rates, ...rest } = p;
    return { firm_index, ...rest };
  });
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: COMPARE_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(ComparisonSchema) },
    messages: [
      {
        role: "user",
        content: `${projectName ? `Project: ${projectName}\n\n` : ""}Proposal extractions (JSON):\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's comparison.", 502);
  return { comparison: msg.parsed_output, usage: usageOf(msg) };
}

/** Reads an RFP and its addenda (already uploaded via /api/upload) in one call. */
export async function reviewRfp(files: { file_id: string; filename: string }[]): Promise<{ rfp: Rfp; usage: Usage }> {
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: RFP_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(RfpSchema) },
    messages: [
      {
        role: "user",
        content: [
          ...files.map((f) => ({ type: "document" as const, title: f.filename, source: { type: "file" as const, file_id: f.file_id } })),
          { type: "text", text: files.length > 1 ? "Review this RFP and its addenda (in the order given)." : "Review this RFP." },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's RFP review.", 502);
  return { rfp: msg.parsed_output, usage: usageOf(msg) };
}

/** Checks a project's consultant proposals against its RFP review. Text only (no PDFs), so it's quick and cheap. */
export async function checkProject(rfp: Rfp, proposals: Proposal[]): Promise<{ check: ProjectCheck; usage: Usage }> {
  const payload = proposals.map((p, firm_index) => {
    const { hourly_rates, fee_items, ...rest } = p;
    return { firm_index, ...rest };
  });
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: CHECK_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(ProjectCheckSchema) },
    messages: [
      {
        role: "user",
        content: `RFP review (JSON):\n${JSON.stringify(rfp)}\n\nConsultant proposal extractions (JSON):\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's project check.", 502);
  return { check: msg.parsed_output, usage: usageOf(msg) };
}

// A starting fee drafted from the RFP review: budget, and the firm's own architecture and interior design work
// (FF&E included when the RFP asks for it) by phase, task and role. Consultants are left to their own proposals.
export const FeeDraftSchema = z.object({
  budget: z.object({
    by: z.enum(["amount", "area"]),
    amount: z.number().nullable(),
    area: z.number().nullable(),
    cost_per_sf: z.number().nullable(),
    basis: z.string(),
  }),
  target_percent: z.number(),
  phases: z.array(
    z.object({
      name: z.string(),
      target_share: z.number(),
      tasks: z.array(z.object({ name: z.string(), hours: z.array(z.object({ role_id: z.string(), hours: z.number() })) })),
    }),
  ),
  expenses: z.number().nullable(),
  assumptions: z.array(z.string()),
});
export type FeeDraft = z.infer<typeof FeeDraftSchema>;

const FEE_DRAFT_SYSTEM = `You are a senior principal at an architecture and interior design firm preparing a first-pass fee for a proposal response. You receive the firm's review of the RFP (JSON) and the firm's staff roles with hourly billing rates. The review may have been edited by the team: a "notes" field holds what they know beyond the RFP (client calls, site visits, reading between the lines), and a discipline marked requested "needed" isn't asked for in the RFP but the team has decided the project needs it. Treat both as current and more reliable than the RFP text where they differ. Estimate only the firm's own work: architecture and interior design, plus FF&E (furniture, fixtures and equipment selection, specification and coordination) when the RFP includes it. Do not estimate engineering or other consultants (structural, MEP, civil, lab planning, hazardous materials, cost estimating, etc.); their fees come from their own proposals. Draft a realistic starting fee the team will then adjust.

- budget: use the construction budget the RFP states. If it gives a range, use the midpoint and say so. If it states none, estimate one from the building size, building type, scope (new construction vs. renovation) and location, using by "area" with area in SF and a typical cost_per_sf; otherwise by "amount" with amount set and area/cost_per_sf null (fill area and cost_per_sf too if the RFP gives both size and budget, but keep by "amount"). basis: one plain sentence on where the budget came from.
- target_percent: a typical fee for the firm's own architecture and interior design work (FF&E if included) on this project type, size and delivery method, as a percent of construction cost, not counting engineering or other consultants.
- phases: only the phases the RFP asks the team to provide (facts.phases and services), in order, using these names where they fit: Pre-design, Schematic Design, Design Development, Construction Documents, Bidding, Construction Administration, Closeout. target_share is each phase's typical share of the architect's labor; shares add up to 100.
- tasks: 2–6 per phase, specific to this project's architecture and interiors work (e.g. "Teaching lab layouts and casework", "Finish and furniture selections"); coordinating consultants' work is a task, their design work is not. When FF&E is in scope, include FF&E tasks in the phases where they happen (programming and selections in design, specifications and bid packages in CD and bidding, procurement and installation review in CA). hours: realistic hours for each role that would do the work, using only the role_ids given; leave out roles with no hours. Size the hours so the labor (hours × rates) comes out close to target_percent of the budget.
- expenses: reimbursables if the RFP calls for them separately, else null.
- assumptions: up to 6 short lines a reviewer must check: the budget basis, the architecture/interiors/FF&E scope you assumed (say whether FF&E is included and why), and anything the RFP leaves unclear that moves the fee.
- Whole numbers for hours and dollars. Don't invent RFP facts; when you assume something, list it in assumptions.`;

/** Drafts a starting fee from an RFP review. Text only (no PDFs), so it's quick and cheap. */
export async function draftFee(rfp: Rfp, roles: { id: string; name: string; rate: number | null }[]): Promise<{ draft: FeeDraft; usage: Usage }> {
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: FEE_DRAFT_SYSTEM,
    output_config: { effort: "high", format: betaZodOutputFormat(FeeDraftSchema) },
    messages: [
      {
        role: "user",
        content: `RFP review (JSON):\n${JSON.stringify(rfp)}\n\nStaff roles and hourly rates (JSON):\n${JSON.stringify(roles)}`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's fee draft.", 502);
  return { draft: msg.parsed_output, usage: usageOf(msg) };
}

export type ChatTurn ={ role: "user" | "assistant"; content: string };

export async function chat(
  proposals: (Proposal & { file_id: string; source_file: string })[],
  comparison: Comparison,
  projectName: string | null,
  turns: ChatTurn[],
): Promise<ChatResponse & { usage: Usage }> {
  const docs = proposals.map((p, i) => ({
    type: "document" as const,
    title: `firm_index ${i}: ${p.firm} (${p.source_file})`,
    source: { type: "file" as const, file_id: p.file_id },
  }));
  const extractions = proposals.map(({ file_id, source_file, ...p }, firm_index) => ({ firm_index, ...p }));
  const context = `${projectName ? `Project: ${projectName}\n\n` : ""}Extracted data (JSON):\n${JSON.stringify(extractions)}\n\nCurrent analysis (JSON):\n${JSON.stringify(comparison)}`;

  const [first, ...rest] = turns;
  const stream = getClient().beta.messages.stream({
    ...BASE,
    system: CHAT_SYSTEM,
    // Most chat turns are lookups; medium effort keeps them cheaper and faster than the high used for reading.
    output_config: { effort: "medium", format: betaZodOutputFormat(ChatWireSchema) },
    messages: [
      { role: "user", content: [...docs, // PDFs + data + analysis are identical across turns (until a correction), so they're cached:
        // follow-up questions read them at the cache rate.
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
        { type: "text", text: first.content },] },
      ...rest.map((t) => ({ role: t.role, content: t.content })),
    ],
  });
  const msg = await stream.finalMessage();
  checkStop(msg);
  if (!msg.parsed_output) throw new UserFacingError("Couldn't parse Claude's reply.", 502);
  return { ...applyChatUpdates(msg.parsed_output, proposals.length), usage: usageOf(msg) };
}

/** Parses and validates the chat's JSON-text corrections. Anything malformed is dropped and the reply says so. */
function applyChatUpdates(wire: z.infer<typeof ChatWireSchema>, firmCount: number): ChatResponse {
  const parse = <T>(schema: z.ZodType<T>, text: string): T | null => {
    try {
      const r = schema.safeParse(JSON.parse(text));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  let failed = false;
  let updated_comparison: Comparison | null = null;
  if (wire.updated_comparison_json.trim()) {
    updated_comparison = parse(ComparisonSchema, wire.updated_comparison_json);
    if (!updated_comparison) failed = true;
  }
  const updated_proposals: ChatResponse["updated_proposals"] = [];
  for (const u of wire.updated_proposals) {
    const proposal = u.firm_index >= 0 && u.firm_index < firmCount ? parse(ProposalSchema, u.proposal_json) : null;
    if (proposal) updated_proposals.push({ firm_index: u.firm_index, proposal });
    else failed = true;
  }
  const reply = failed
    ? `${wire.reply}\n\n(Note: part of this correction came back malformed, so it was not applied. The tables may not reflect it yet; ask again to retry.)`
    : wire.reply;
  return { reply, updated_comparison, updated_proposals };
}

// Converts any thrown error into a JSON Response with a readable message.
export function errorResponse(err: unknown): Response {
  let status = 500;
  let message = "Unexpected server error.";
  if (err instanceof UserFacingError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof Anthropic.AuthenticationError) {
    message = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  } else if (err instanceof Anthropic.RateLimitError) {
    status = 429;
    message = "Rate limited by the Anthropic API. Wait a minute and retry.";
  } else if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    status = 402;
    message = "The Anthropic account is out of API credits. Add credits under Plans & Billing in the Claude Console, then retry.";
  } else if (
    err instanceof Anthropic.NotFoundError ||
    (err instanceof Anthropic.BadRequestError && /file/i.test(err.message) && /not found|does not exist/i.test(err.message))
  ) {
    status = 410;
    message = "The source PDFs have expired (they're deleted after a day). Run the comparison again to keep chatting.";
  } else if (err instanceof Anthropic.BadRequestError) {
    status = 400;
    message = `Anthropic API rejected the request: ${err.message}`;
  } else if (err instanceof Anthropic.APIError) {
    status = 502;
    message = `Anthropic API error (${err.status ?? "network"}). Try again.`;
  }
  // Log status only — never document content.
  console.error(`[api] ${status}: ${message}`);
  return Response.json({ error: message }, { status });
}
