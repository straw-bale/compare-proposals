# Proposal Comparison

Upload two or more MEP consultant proposals (PDF). Claude reads each one, then the tool shows:

- **Fees**: total (lowest highlighted), per-phase breakdown, additional services, reimbursables, hourly rates, CA visits, schedule, payment terms. Totals are calculated in code from the fees each proposal states.
- **Briefing**: headline, overview, flagged issues/inconsistencies, and clarification questions to send each firm.
- **Scope**: a normalized checklist grouped by discipline. Each firm is marked ✓ included / Opt / ✕ excluded / — not mentioned, and hovering a cell shows its note and page reference. A "Show differences only" toggle hides rows where every firm matches.
- **Proposal details** (collapsed): exclusions, assumptions, clarifications, and deliverables for each firm.
- **Ask / correct**: a chat panel that can see the original PDFs and the analysis. Ask questions, or ask it to fix something; corrections update the tables and briefing in place.
- **Recent comparisons**: every comparison (and its chat) is saved automatically in this browser and can be reopened or deleted from the start page. Nothing is shared between computers or browsers. If a saved comparison is older than a day, its PDFs have been deleted from Anthropic, so the chat offers **Re-attach PDFs** (pick the same files) instead of re-running the analysis.
- **Print / PDF**: a print-ready layout. Pages print portrait by default; choose landscape in the print dialog if you want it.

## Run locally

```
npm install
copy .env.example .env.local    # then paste your key into .env.local
npm run dev
```

Open http://localhost:5173.

## Deploy (Vercel)

1. `vercel` (or import the repo in the Vercel dashboard; it auto-detects Vite).
2. Add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables.
3. **Turn on Deployment Protection** (Settings → Deployment Protection: password or Vercel Authentication) before sharing the URL. Otherwise anyone with the link can use your API key.

Limits on Vercel: each PDF must be under ~4.4 MB (the platform caps request bodies at 4.5 MB), so compress larger PDFs first. Each request can run for up to 5 minutes. Locally there's no size cap.

## How it works

| Step | Endpoint | What happens |
|---|---|---|
| 1 | `POST /api/extract` | One call per PDF, run in parallel. The PDF goes to Claude as a document block, and Claude returns structured JSON (`ProposalSchema` in `lib/claude.ts`). |
| 2 | `POST /api/compare` | All extractions (text only) go to Claude, which returns the master scope checklist and watch-outs (`ComparisonSchema`). |

- Model: `claude-opus-5-5` at `effort: "high"`, with structured outputs and the server-side refusal fallback enabled.
- Prompts and schemas live in `lib/claude.ts`. Edit the prompts there to change how scope gets categorized.
- `dev-api-plugin.ts` serves the `/api` handlers inside the Vite dev server, so local dev doesn't need the Vercel CLI.

## Data handling (SOC 2 notes)

- The API key is read only on the server (`.env.local` or Vercel env vars) and is never bundled into the browser code.
- PDFs are uploaded to your Anthropic account (Files API) so the chat can re-read them without re-uploading. Each run deletes this app's files older than one day; only files whose names start with `proposal-comparison__` are touched. Results aren't stored anywhere; they live in the browser tab.
- Server logs record status messages only, never document content.
- Chat cost: the PDFs are prompt-cached, so follow-up questions read them at about 5% of the normal input price for as long as you keep chatting (the cache lapses after ~5 minutes idle).
- Vendors: Anthropic API (SOC 2 Type II; commercial API inputs aren't used for training) and Vercel (SOC 2 Type II). Request the reports from trust.anthropic.com and vercel.com/security for your vendor file. Ask Anthropic about Zero Data Retention if a client contract requires it.
