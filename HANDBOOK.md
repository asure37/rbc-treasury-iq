# RBC Treasury Intelligence — Maintainer's Handbook

Everything a new owner needs to run, change, and extend this application.

**Repository** `git@github.com:asure37/rbc-treasury-iq.git`
**Live** `https://rbc-treasury-iq.onrender.com`
**Stack** Next.js 16.2 (App Router) · React 19 · TypeScript 5 · Tailwind v4 · Recharts · Anthropic SDK
**Size** ~11,000 lines of TypeScript across 79 source files, plus 8 data files
**Built for** the RBC CFO Group Student Ambitious Ideas Competition, by "Trustees of Treasury"

---

## Table of contents

1. [What this application is](#1-what-this-application-is)
2. [Five-minute orientation](#2-five-minute-orientation)
3. [Running it](#3-running-it)
4. [Deployment](#4-deployment)
5. [The data model](#5-the-data-model)
6. [Architecture map](#6-architecture-map)
7. [The lineage system — the most important part](#7-the-lineage-system--the-most-important-part)
8. [The AI surfaces](#8-the-ai-surfaces)
9. [Exports](#9-exports)
10. [Authentication — there is none](#10-authentication--there-is-none)
11. [Runbooks — how to make common changes](#11-runbooks--how-to-make-common-changes)
12. [Known limitations and traps](#12-known-limitations-and-traps)
13. [Verification playbook](#13-verification-playbook)
14. [Cost and rate limits](#14-cost-and-rate-limits)
15. [Glossary](#15-glossary)

---

## 1. What this application is

A peer-benchmarking dashboard comparing **RBC against the five other Canadian D-SIBs** — TD, Scotiabank, BMO, CIBC and National Bank — across 33 capital, liquidity, funding, profitability and interest-rate-risk metrics, over nine quarters (Q3 2024 → Q3 2026).

Plenty of tools can draw those charts. **The thing that makes this one worth maintaining is that every number on screen is clickable and traces to the page of the disclosure it came from.** Click a figure and the source PDF opens at the right page with the exact number highlighted. That property is load-bearing — most of the engineering below exists to protect it, and most of the bugs worth knowing about were violations of it.

### The governing rule

> **Never fabricate, estimate, or interpolate a metric.** Every figure either traces to a real, cited public disclosure, or it stays `null` and the UI says so.

This is not a style preference. It is the product's entire claim. Anything that guesses — a highlight that lands on a plausible-looking number, a value carried forward from last quarter, a rank produced by a sort that doesn't follow from the cells — destroys the credibility of all 1,655 figures at once. When you are unsure whether to show something uncertain or show nothing, **show nothing and say why.**

### Current data coverage

| | |
|---|---|
| Banks | 6 (RBC, TD, Scotiabank, BMO, CIBC, National) |
| Quarters | Q3 2024 → Q3 2026 — 9 for BMO, Scotiabank and National; 8 for RBC, TD and CIBC, which have not yet reported Q3 2026 |
| Metrics defined | 33 |
| Populated values | 1,655 of 1,683 possible cells (98%) |
| Source references | 1,615 (1,583 with a page number, 1,432 with a label anchor) |
| Per-metric caveats | 1,293 free-text notes |
| Distinct cited documents | 94, all on the issuing bank's own domain |
| Credit ratings | 6 banks (Moody's / S&P / DBRS / Fitch) |
| **Citations that highlight on their cited page** | **1,364 of 1,615 (84.5%)** — and **0** land on any other page |

That last row is the one to watch. 251 citations ring nothing (§12) — they open the right document at the right page and show no highlight, which is the honest failure. **What must never happen is a citation resolving somewhere it wasn't cited**, and that count is zero across the whole dataset.

Every number in that table is measured, not asserted:

```bash
npm run stats     # the coverage rows
npm run probe     # the highlight row
```

If a figure in this handbook ever disagrees with those scripts, **the scripts are right.** Update the prose.

---

## 2. Five-minute orientation

```
src/
├── app/
│   ├── page.tsx            entry — renders AppGate
│   ├── layout.tsx          fonts, metadata, global CSS
│   ├── globals.css         Tailwind v4 @theme tokens (no tailwind.config.js)
│   └── api/                7 server routes (see §6)
├── components/
│   ├── auth/               login, welcome, animated backdrops
│   ├── dashboard/          the 7 tabs + panels/modals
│   ├── charts/             Recharts wrappers
│   ├── chat/               chat widget, message, chart block
│   └── ui/                 GlassCard, AnimatedNumber, DeltaBadge, Mark
├── lib/                    all logic that isn't a component
└── types/                  metrics.ts (the data model), auth.ts, chart-spec.ts
data/
├── banks/*.json            6 files — the entire dataset
├── metrics-meta.json       25 metric definitions + regulatory thresholds
└── employees.json          login credentials
scripts/
├── dataset-stats.py        measures the dataset (every number in §1)
└── lineage-probe.mts       re-resolves every ref against its real PDF (§13)
```

```bash
npm run check     # tsc + eslint + build — all three must pass
npm run stats     # dataset coverage
npm run probe     # lineage regression (add -- --download on first run)
```

**Read these four files first, in this order.** They will teach you 80% of the system:

1. `src/types/metrics.ts` — the data model, heavily commented
2. `data/banks/rbc.json` — what a bank record actually looks like
3. `src/lib/source-match.ts` — how a figure is located in a PDF (the heart of the lineage claim)
4. `src/components/dashboard/SourcesTab.tsx` — how lineage reaches the screen

### The seven tabs

| Tab | Component | What it does |
|---|---|---|
| Overview | `OverviewTab` | RBC KPI cards + the peer rank heat map |
| Historical Trends | `TrendsTab` | Multi-bank line charts over 8 quarters |
| Peer Comparison | `PeerCompareTab` | Rank bars, radar, share pie, two bubble charts, credit ratings |
| Funding & IRRBB | `FundingTab` | Deposit composition, IRRBB sensitivity table |
| Variance & Outliers | `VarianceTab` | Automated QoQ anomaly + peer-outlier detection |
| Data Lineage | `SourcesTab` | Every figure, clickable → source PDF; evidence pack export |
| Treasury IQ Assistant | `AssistantTab` | Grounded AI chat + the e-MRI Scan panel |

Tab state lives in `src/lib/store.ts` (Zustand). The dashboard data is loaded server-side and passed through `src/lib/data-context.tsx`.

---

## 3. Running it

```bash
npm install
cp .env.example .env.local        # then paste a real ANTHROPIC_API_KEY
npm run dev                       # http://localhost:3000, hot reload
```

For anything you intend to trust, use a production build — dev mode masks real behaviour (`maxDuration`, bundling, `serverExternalPackages`):

```bash
npm run build && npm start
```

No login — the app opens on the welcome screen (see [§10](#10-authentication--there-is-none)).

### Before every commit

```bash
npm run check
```

That runs `tsc --noEmit`, `eslint src` and `next build`; all three must be clean. There is no test suite — see [§13](#13-verification-playbook) for how this project verifies instead. If you touched matching, refs or data, run `npm run probe` too.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, for AI features | Powers the assistant, e-MRI Scan, and quarterly refresh |
| `NODE_VERSION` | Render only | Pinned to 22 in `render.yaml` |

Without the key the dashboard, charts, lineage viewer and exports all work; the three AI routes return a clean 503. `.env*` is gitignored except `.env.example` — **never commit a real key.**

---

## 4. Deployment

Render, configured by `render.yaml` (a Blueprint — Render reads it automatically on connect). Auto-deploys on push to `main`.

```yaml
runtime: node · plan: free · region: oregon
buildCommand: npm install && npm run build
startCommand: npm run start
```

**Why not Vercel:** its filesystem is read-only, which breaks the refresh "Apply" step that writes to `data/banks/*.json`. Any persistent Node host works — Render, Railway, Fly.

**Free-tier cold start:** the instance sleeps after ~15 minutes idle and takes ~50s to wake. *For a live demo, open the URL a minute beforehand,* or set `plan: starter` ($7/mo) in `render.yaml` for always-on.

**Applied refreshes do not survive a redeploy.** The container resets to committed data. To persist, either commit the updated JSON (the honest path — it keeps the dataset reviewable in git) or mount a Render persistent disk at `data/`.

---

## 5. The data model

`src/types/metrics.ts` is the single source of truth. Read it directly; this is the shape.

```
BankData
├── bankId, bankName, ticker, colorHex, isHomeInstitution
├── quarters: QuarterMetrics[]          (oldest → newest)
│   ├── period "Q2 2026", periodEnd "2026-04-30"
│   ├── reportName / reportUrl          the quarter's primary disclosure
│   ├── supplementaryReportName / Url   optional second document
│   ├── retrievedAt                     when this was ingested/verified
│   ├── metrics:     { [MetricKey]: number | null }
│   ├── notes:       { [MetricKey]: string }      caveats, derivations
│   └── sourceRefs:  { [MetricKey]: SourceRef }   ← the lineage
├── creditRatings                       point-in-time, per agency, each with its own source
├── marketData                          book value/share + Yahoo symbol, for the P/B chart
└── irrbbDisclosureNote/SourceName/Url  qualitative IRRBB framework description
```

### `SourceRef` — the most important type in the codebase

```ts
interface SourceRef {
  url?: string;         // defaults to the quarter's reportUrl
  page?: number;        // 1-indexed PDF page
  searchText?: string;  // the figure exactly as printed, e.g. "13.5" or "4.4%"
  anchorText?: string;  // the label preceding it, e.g. "leverage ratio"
}
```

**`anchorText` is what stops the viewer highlighting the wrong number.** BMO's Q2 2026 report states both ROE and CET1 as 13.0%; without an anchor, a search for "13.0" highlights whichever comes first. With `anchorText: "cet1 ratio"`, the matcher requires the label and the figure to appear together. 1,432 of 1,615 refs have one — the rest are flagged `NO_ANCHOR` in exported evidence packs so a reviewer knows the match is weaker.

### Fiscal calendar

Canadian D-SIBs have an **October 31 year end**. This trips up everyone:

| Fiscal quarter | Ends | Typically reported |
|---|---|---|
| Q1 | Jan 31 | late Feb |
| Q2 | Apr 30 | late May |
| Q3 | Jul 31 | late Aug |
| Q4 | Oct 31 | early Dec |

`src/lib/quarters.ts` encodes this (`getNextQuarter`, `isLikelyReported`, `expectedReportDate`).

### `metrics-meta.json`

25 definitions carrying `label`, `shortLabel`, `unit` (`%` / `$B` / `$M`), `description`, `decimals`, `regulatoryMinimum`, `supervisoryTarget`, and:

**`higherIsBetter: boolean | null`** — drives every ranking in the app. `false` for efficiency ratio and the IRRBB sensitivities (lower is better); `null` where it's genuinely context-dependent (balance-sheet mix). Get this wrong on a new metric and every rank, heat map cell and "leader" label inverts silently.

---

## 6. Architecture map

### API routes (`src/app/api/`)

| Route | Runtime cap | Purpose |
|---|---|---|
| `chat` | 60s | Treasury IQ Assistant. Streaming tool-use loop (max 4 iterations) with web search + a `render_chart` tool. Grounded in the dataset via `chat-context.ts`. |
| `discover` | 300s | e-MRI Scan. Agentic loop (max 10 iterations) with web search, web fetch, SEC EDGAR XBRL, and a `report_finding` tool. Server-side verifies every figure against its source before streaming it. |
| `refresh` | 300s | Quarterly data refresh. Per bank (120s cap each), finds the next unreported quarter, extracts metrics, sanity-checks and verifies them. Streams NDJSON progress. **Proposes only — never writes.** |
| `refresh/apply` | — | Writes accepted proposals to `data/banks/*.json`, taking a timestamped backup first. |
| `pdf-proxy` | 60s | Fetches source PDFs server-side so the client viewer isn't blocked by CORS. |
| `market` | — | Live TSX quotes via Yahoo Finance, 20s cache, falls back to the disclosed quarter-end close. |
| `login` | — | Validates employee ID + shared team passcode. |

All three AI routes use **`claude-sonnet-5`** with `thinking: { type: "adaptive" }`.

**`pdf-proxy` is an allow-list, not an open proxy.** It serves only URLs that appear in the dataset, or that `/api/discover` verified this session (`src/lib/discovered-sources.ts`, which also blocks loopback, private and link-local addresses). **Do not relax this** — it would become an SSRF relay.

### Key libraries (`src/lib/`)

| Module | Role |
|---|---|
| `source-match.ts` | **The lineage engine.** Locating a figure in a PDF. See §7. |
| `evidence-pack.ts` | Builds the audit evidence pack (PDF + CSV + JSON). Client-side. |
| `api-errors.ts` | `friendlyApiError` / `isRetryableApiError` / `safeErrorText`. See §12. |
| `data.ts` | Server-side dataset loading; tolerates a corrupt bank file by dropping it |
| `analytics.ts` | Series extraction, QoQ changes, anomaly + peer-outlier detection, peer averages |
| `quarters.ts` | Fiscal-quarter arithmetic and reporting-window logic |
| `refresh.ts` | Extraction prompt, response parsing, sanity checks |
| `source-verify.ts` | Server-side "is this figure really in that PDF" check |
| `sec-edgar.ts` | SEC XBRL company/tag/value lookups (the `finagg`/`edgartools` datasets, over EDGAR's JSON APIs so it deploys with the Node app) |
| `deck-builder.ts` | PowerPoint + PDF deck generation |
| `chat-context.ts` | Builds the assistant's system prompt from current view state |
| `store.ts` / `auth-store.ts` / `data-context.tsx` | Zustand stores + React context |

---

## 7. The lineage system — the most important part

If you change one thing carelessly, make it not be this.

### The one-implementation rule

`src/lib/source-match.ts` contains the **entire** algorithm for deciding where a citation points — matching, page resolution, and highlight geometry. Both the on-screen viewer (`SourceViewerModal`) and the exported evidence pack call the same `resolveRef()`.

This was not always true. The page-resolution logic used to live inside React effects, so the exporter couldn't call it and grew its own copy. Two copies drift on the first bug fix, and the failure mode is the worst one available: **an evidence pack whose screenshot rings a different number than the reviewer sees on screen.** If you find yourself writing a second matcher, stop and extend the shared one.

### How a figure is located

1. **Normalize** — lowercase, collapse whitespace, fold typographic quotes (a PDF's text layer and text captured elsewhere disagree on `"` vs `"`).
2. **Value variants** — pdf.js splits `$` and `%` into separate text items, so `$619,452` becomes `$ 619,452`. Try the recorded form, the spaced forms, then the bare number — most specific first.
3. **Whole-number boundaries** — a match may not be a fragment of a longer number. This is why `4.2` does not match inside `c$4.233 billion`, `184.7 million shares`, or `$14.36 million`.
4. **Anchored search** — if `anchorText` exists it is **required**: find the label, then the figure within 240 normalized characters after it. No label on the page → no highlight. Never a bare fallback.
5. **Page resolution** — try the cited page, then its two neighbours (anchored citations only). `resolveRef` can widen to a document-wide scan, but **only when the caller opts in** via `scanBeyondCitedPage`. The evidence pack enables it for e-MRI findings (whose page number came from a live agent) and leaves it off for the curated dataset (whose pages were verified against these documents — a miss there is a finding worth reporting, not a cue to go looking elsewhere).
6. **Geometry** — the highlight box is stored as a *fraction of the page*, so it covers the same characters at any render scale. Padding is applied per-viewport, never baked in.

### Key constants

| Constant | Value | Meaning |
|---|---|---|
| `ANCHOR_WINDOW` | 240 chars | Max distance from label to figure |
| `MAX_SCAN_PAGES` | 150 | Scan depth when no page is recorded |
| `HIGHLIGHT_PAD` | 2.5 PDF units | Scaled by viewport, not fixed pixels |

`MAX_SCAN_PAGES` is deliberately shared: **if the exporter searched deeper than the viewer, a pack could evidence a figure the viewer is unable to show.**

### Why the fallbacks are so restricted

A real bug, worth internalising. Clicking BMO's Q2 2026 Basel III leverage ratio (4.3%) used to open **page 6** and highlight `4.3%` in this sentence:

> "Despite weak job growth, the unemployment rate remained at relatively low levels of **4.3%** in April 2026"

The leverage ratio is on page 7. Three defects compounded: the neighbour-page fallback raced ahead of the cited page's own search (canvas rendering is far slower than reading a neighbour's text layer, so the fallback always won); the matcher fell back to the first bare occurrence when the anchor was missing; and substring matching accepted fragments of longer numbers.

Across the 723 refs whose documents were cached at the time, **62 were being relocated to a neighbouring page, 40 of them onto an unrelated number.** After the fix, the full 1,121-ref probe reports **zero relocations** — every citation that resolves at all resolves on the page it cites — with 97 refs honestly showing no highlight rather than a wrong one (§12).

The lesson generalises: **every loosening of these rules trades a visible "no highlight" for an invisible wrong one.** The first is a bug report; the second is a credibility failure nobody catches until a judge does.

---

## 8. The AI surfaces

### Treasury IQ Assistant (`/api/chat`)

Grounded chat. `chat-context.ts` builds a system prompt containing the current dataset and view state, so the assistant answers from real figures rather than memory. It can call web search, and `render_chart` to draw a chart inline (validated server-side against `types/chart-spec.ts`). Appears as a floating widget on every tab and full-width on the Assistant tab.

### e-MRI Scan — External Metrics, Reporting & Insights (`/api/discover`)

Sources **any** financial figure from **any** company — not just treasury, not just the six banks. That is the scalability argument: the same lineage machinery serves Finance, Investor Relations and Risk. The default examples deliberately span an insurer's LICAT ratio, a wealth manager's AUM, a segment P&L and a P&C combined ratio.

The loop: search → fetch the document → call `report_finding` → **the server independently re-fetches the source and confirms the figure is really in it** → stream the finding with its verification verdict. Confirmed PDF findings auto-open the viewer at the highlighted figure.

Three things worth knowing:

- **It refuses to invent.** Asked for a period that hasn't been published, it says so and offers the most recent real one.
- **Verification can disagree with the agent**, and that disagreement is surfaced rather than smoothed over.
- **SEC EDGAR XBRL** is tried first for SEC filers, because an XBRL fact carries the accession number of the filing it was reported in — a stronger citation than prose scraped off a page.

### Quarterly refresh (`/api/refresh`)

Finds each bank's next unreported quarter, extracts the 25 metrics from its new disclosure, sanity-checks each value against the prior quarter (`checkSanity` flags large moves, missing values, out-of-range), and verifies figures against the source PDF.

**It proposes; it never writes.** A human reviews each proposal in `RefreshDataPanel` and clicks Apply, which calls `/api/refresh/apply` — that route takes a timestamped backup of each bank file before writing, and guards `bankId` against path traversal.

---

## 9. Exports

| Export | Where | Output |
|---|---|---|
| **Evidence pack** | Data Lineage tab, e-MRI Scan panel | PDF + register CSV + JSON log, sharing one deterministic Pack ID |
| **PowerPoint deck** | Header → Export PowerPoint | .pptx with native editable charts + matching PDF |
| **Raw CSV** | Data Lineage tab, header | Full dataset |
| **Chart PNG** | Expandable chart cards | Single chart image |

### The evidence pack is the differentiator

For every figure in scope it records the document, the page, **a screenshot of that page with the figure ringed**, the text extracted around it, and a **SHA-256 of the bytes examined**. Two invariants:

1. **It re-verifies.** Nothing is copied from a stored flag — each figure is re-located in its source at export time, through the same resolver the viewer uses. The pack reports what is true now, not what was true when the data was gathered.
2. **It never quietly drops a figure.** Every item produces exactly one record, the count is asserted on the cover, and anything unevidenced is carried in as a classified exception — **printed before the evidence, not after.**

Structure: Cover (scope, coverage arithmetic that foots, and four lines on what the pack does *not* assert) → **Exceptions** → Method (how to re-perform the check by hand and by machine) → Evidence register → one page per figure → Source receipts.

Exception classes include `NO_ANCHOR`, `AMBIGUOUS`, `PAGE_DRIFT`, `DERIVED`, `VALUE_NOT_FOUND`, `WEB_PAGE_SOURCE`, `NOT_A_PDF`, `RENDER_BLANK`.

**Cost warning:** each bank-quarter is its own document. A 48-figure selection fetches ~44 PDFs (~80 MB, 2–4 minutes). The dialog shows the document count before you commit and offers a register-only mode.

---

## 10. Authentication — there is none

**The login gate was removed.** Visitors land directly on the welcome screen and click through to the dashboard. `auth-store.ts` starts at `stage: "welcome"`, and `AppGate` renders `WelcomeScreen` for any stage that isn't `"dashboard"`.

> **The whole application is public to anyone with the URL** — the dashboard, the exports, and the AI routes that spend Anthropic credits. The gate was never security (the API routes were never auth-gated), but it is now absent entirely. Treat the URL as the only control.

### Restoring the gate

Everything needed is still in the repo — nothing was deleted:

1. `src/lib/auth-store.ts` — set the initial `stage` back to `"login"` (and `logout` back to `"login"`).
2. `src/components/auth/AppGate.tsx` — re-import `LoginScreen` and restore the two-branch render:
   ```tsx
   {stage === "login" && <LoginScreen key="login" />}
   {stage === "welcome" && <WelcomeScreen key="welcome" onContinue={advanceToDashboard} />}
   ```
3. `src/components/auth/WelcomeScreen.tsx` — swap `BRAND` back for the `firstName` greeting if you want the personalised version.
4. `src/components/dashboard/Header.tsx` — restore the `Hi, {firstName}` label and the sign-out button.

`LoginScreen.tsx`, its three animated backdrops, `POST /api/login`, and `data/employees.json` (one shared `teamPasscode` plus 32 `{ employeeId, firstName }` records) are all still present and functional — the login route still validates correctly, it simply has no UI pointing at it. Deploying an earlier commit on Render also restores the gate wholesale.

One trap worth keeping in mind if you do restore it: the credential list is imported *statically* (`import employeesJson from ".../employees.json"`) so it is bundled at build time, with an on-disk read preferred at runtime. A bare `readFile(process.cwd()/…)` 500s wherever the deploy layout differs — that caused a production login outage once.

---

## 11. Runbooks — how to make common changes

### Add a quarter of data

**Preferred — the built-in refresh:** Data Lineage tab → **Refresh data** → review each proposal (check the sanity flags and verification status) → **Apply**. Then **commit the changed `data/banks/*.json`**, because a redeploy resets the container.

**Manual:** append a `QuarterMetrics` object to each bank's `quarters` array (they must stay oldest → newest). Every value needs a `sourceRef` with `page`, `searchText` (the figure exactly as printed) and `anchorText` (the label preceding it). Verify with the probe in §13 before committing.

### Add a metric

1. Add the key to the `MetricKey` union in `src/types/metrics.ts`.
2. Add a definition to `data/metrics-meta.json` — **set `higherIsBetter` deliberately**; it drives every ranking.
3. Populate values + `sourceRefs` in each bank file (or leave `null` — never guess).
4. TypeScript will point you at anything that needs updating. It will appear automatically in the heat map, lineage tab, exports and metric selectors.

### Add a bank

1. Create `data/banks/<id>.json` matching the `BankData` shape.
2. Set a distinct `colorHex` — official brand colours are in use (TD `#54b946`, CIBC `#c41f3e`, BMO `#0279c1`, Scotia `#ee121b`, National grey).
3. It is picked up automatically — `getAllBankData` reads the directory. Home institution sorts first, then alphabetically.
4. `provenanceOf` in `/api/discover` derives issuer domains from `quarters[0].reportUrl`, so first-party detection works with no extra config.

### Change branding or theme

Colours and tokens live in `src/app/globals.css` under Tailwind v4's `@theme inline`. **There is no `tailwind.config.js`** — v4 configures in CSS. Per-bank chart colours are `colorHex` in each bank file.

### Fix a wrong highlight

1. Open the figure in the Data Lineage tab and see where it actually lands.
2. Run the probe against that issuer — it prints the status and the cited-vs-resolved page for every miss:

   ```bash
   node scripts/lineage-probe.mts --bank bmo
   ```

3. Usually the fix is a better `anchorText` (more distinctive, verbatim from the page) or a `searchText` matching exactly how the document prints it — including the `%` and the `$`.
4. Re-run the probe across **all** refs to confirm you changed only what you intended. Tightening one ref by loosening the matcher would move others silently, which is why the full run is the one that counts.

---

## 12. Known limitations and traps

### Things that will bite you

**`pdfjs-dist` must stay in `serverExternalPackages`** (`next.config.ts`). Bundling it into the server output makes the dynamic import fail at runtime and *silently* downgrades source verification to "unreachable" — no error, just quietly worse results.

**For an Anthropic `APIError`, `err.message` IS the raw JSON body.** Surfacing it prints `{"type":"error",…,"request_id":"req_…"}` on screen as though the assistant said it. This happened in a demo. Always go through `friendlyApiError()` server-side and `safeErrorText()` client-side.

**`maxRetries` does not cover a mid-stream overload.** The SDK decides retries from the HTTP response, but a 529 during a streamed turn arrives as an SSE error frame *after* the 200 is committed. Both agent loops therefore retry the individual iteration explicitly, with 1.5s/4s/9s backoff. Raising `maxRetries` only helps connection-level failures.

**Recharts gives negative bars a negative width**, so `position="right"` lands at the bar tip, over the axis labels. `PeerBarChart` uses a sign-aware custom label renderer.

**pptxgenjs colours per series, not per data point.** A single-series bar chart needs an *array* of chart colours to colour each bar — otherwise every bank comes out the same colour.

**jsPDF's built-in Helvetica is WinAnsi-encoded.** Em dashes, arrows and ellipses render as garbage. Everything printed into an evidence pack goes through `ascii()`; the CSV and JSON carry the exact original characters, and the pack's Method page says so.

**Browsers silently return blank canvases under memory pressure** — no exception thrown. The evidence pack samples pixels and reports `RENDER_BLANK` rather than embedding a blank image under a green header.

**Two pdf.js renders must never share a canvas.** An un-cancelled earlier task corrupts the output (it renders mirrored). Cancel the previous render task first.

### Honest gaps in the current product

**Derived figures — the largest hole in the lineage claim.** Some figures are ratios computed from two disclosed inputs rather than numbers the issuer printed. For those, a page image evidences an *input*, not the result, and the pack cannot show the arithmetic.

Exports flag these `DERIVED`, but **the only signal is a regex over the free-text `notes` field** — there is no structured marker. That makes the flag a floor, not a census:

| | |
|---|---|
| Notes that admit a computed figure | **71** |
| Values sitting in the six ratio families | **281** |
| Of those, carrying no note either way | **210** |

The six families are `loansToAssetsPct`, `loanToDepositRatio`, `wholesaleFundingPct`, `efficiencyRatio`, `irrbbNiiSensitivityPct`, `irrbbEveSensitivityPct`. Several issuers *do* publish these directly, so 210 is an upper bound on the unlabelled-derivation problem, not a count of defects — but nothing in the data tells you which of the 210 is which, and that is exactly the ambiguity the product exists to eliminate.

**Building `src/lib/derivations.ts` — keyed by metric key, each operand carrying its own `SourceRef` — is the highest-value next piece of work.** It would replace the regex with a fact, let the pack print `18,432 / 41,006 = 44.9%` with both operands evidenced, and let a reviewer recompute every ratio.

Reproduce the table above with:

```bash
python3 scripts/dataset-stats.py
```

**Two keys are populated but absent from `metrics-meta.json`** — `adjustedEfficiencyRatio` and `fullYearNetIncomeMillions`. They carry data but have no label, unit, threshold or polarity, so they cannot appear in the metric picker or the heat map. Add a meta entry before trying to chart one.

**Comparability.** The pack proves transcription; it cannot prove that LCR means the same thing at six banks with different averaging conventions and deposit-bucket granularity. Today that limit is one line on the cover. It deserves a page.

**`dividendPayoutRatio` is the sharpest example of that, and needs reading before use.** Unlike the capital and liquidity ratios, this one is not defined by a regulator, so the six issuers do not compute it the same way:

| Bank | Basis | Watch for |
|---|---|---|
| RBC, CIBC | Single-quarter, reported | RBC prints only whole percents |
| BMO | Single-quarter, reported (Supplementary line 23) | BMO also publishes an *adjusted* ratio on line 24 that differs by up to 29 points — do not mix the two |
| TD | Single-quarter, reported | Q3 2024 is `n/m` (the AML provision caused a net loss) so the cell is **null**; Q2 2025 reads 16.6% because the Schwab gain inflated the denominator |
| National | **Trailing four quarters** | Structurally different from the others; smoother by construction and not directly comparable |
| Scotiabank | **Not disclosed quarterly** | All eight cells are **null**. Scotia reports a payout ratio only for the full fiscal year (71.0% FY2024; 73.7% reported / 60.7% adjusted FY2025) |

Every one of these caveats is recorded in the per-metric `notes`, and the metric is defined with `higherIsBetter: null` so it never drives a rank or a heat map cell. **Resist the temptation to fill Scotia's column by computing dividends ÷ net income** — the inputs are disclosed, so it would be easy, and it would also be the first fabricated figure in the dataset. It stays null until Scotia publishes one.

By contrast `tlacLeverageRatio` is clean: OSFI's TLAC guideline defines it, all six banks disclose it quarterly, and all 48 cells are populated and cross-checked against an overlapping Pillar 3 or supplementary disclosure.

**97 refs highlight nothing** — 8.7% of the dataset. They cite a real page but ring no figure on it, and they split into two different problems:

| | | |
|---|---|---|
| **81** | `no_search_text` | No figure was ever recorded, so there is nothing to find. Concentrated in BMO (38) and CIBC (26), and overwhelmingly in the derived ratio families — a computed ratio has no printed number to search for, which is the same root cause as the derivations gap above. |
| **16** | `value_not_found` | A figure was recorded but is not findable on the cited page. Mostly short bare integers (`"294"`, `"462"`, `"$21"`) that only ever appeared as fragments of longer numbers, so boundary-aware matching now correctly rejects them. |

Both fail honestly — the viewer opens the right page and shows no highlight rather than ringing a plausible wrong number. Fixing the 16 means recording the figure exactly as the document prints it; fixing the 81 means `derivations.ts`, so each operand carries its own findable ref.

*Earlier drafts of this handbook cited 11 misses. That number came from a partial probe run covering 723 of the 1,034 refs and understated the gap roughly ninefold — a good illustration of why §13 says to run the probe over the whole dataset.*

**82 refs cite a document labelled for a different quarter** (plus 7 citing annual reports, which is legitimate at fiscal year end). Most of the 82 are also legitimate — supplementary packs carry several quarters of history — but they are weaker citations, because a reader must trust that the right column was read. The 30 clearly wrong ones, where RBC Q4 2024, Q2 2025 and Q1 2026 pointed at the *following* quarter's report, have been repointed to each quarter's own disclosure.

Recount with `python3 scripts/dataset-stats.py` before trusting that number — it comes from a URL-naming heuristic, not a field in the data, so a new filename convention at any issuer will shift it.

**No test suite.** See §13.

**Free-tier cold start** and **refresh non-persistence** — see §4.

---

## 13. Verification playbook

There is no automated test suite. What this project does instead — and what you should keep doing — is **verify against reality**: run the real thing, fetch the real documents, and check the real output. Every bug in §12 was found this way, not by reasoning about the code.

### Static checks (every change)

```bash
npx tsc --noEmit && npx eslint src && npm run build
```

### Lineage regression check (any change to matching, refs, or data)

The highest-value check in the project. It re-resolves every `sourceRef` against its real PDF and reports how each one matched.

```bash
node scripts/lineage-probe.mts --download
```

The first run downloads the ~78 cited documents into `.cache/pdfs/` (gitignored, several hundred MB, slow). Later runs reuse the cache and take a couple of minutes. Narrow to one issuer while iterating:

```bash
node scripts/lineage-probe.mts --bank rbc
```

Crucially, **the probe imports `resolveRef` from `src/lib/source-match.ts` rather than reimplementing it.** It is checking the same decision procedure the viewer and the evidence pack use — a reimplementation would drift and start certifying matches the product would never make.

The expected shape for the committed dataset, measured across all 1,121 refs:

```
resolve ON the cited page via anchor     916
resolve ON the cited page unanchored     108
moved to a neighbour                       0
no highlight (honest miss)                97

Miss breakdown:
  no_search_text                          81
  value_not_found                         16
```

**91.3% of citations land on their cited page, and not one resolves anywhere else.** The two miss kinds are different problems and the probe never merges them: `no_search_text` is a gap in the *data* (no figure was recorded to look for), `value_not_found` is a gap in the *match* (a figure was recorded but isn't findable on that page).

**"Moved to a neighbour" must stay 0, and misses must not climb.** Either movement means the matcher got looser and is relocating citations — the exact defect behind the leverage-ratio bug in §7. The probe exits non-zero in that case, so it can gate CI. A `--bank` or partially-cached run covers a subset and suppresses the baseline comparison rather than reporting a false regression.

Requires Node ≥ 22.18 for native TypeScript type-stripping; `source-match.ts` has no runtime imports, so it loads directly.

### Browser verification (any UI change)

Run a production build and drive the real app. Confirm a figure click opens the right page with the right number ringed; check the console for errors.

### AI-surface verification

Run an actual scan end to end. The bugs found this way — a wrong page, a mislabelled provenance, a `not_found` on a figure that was present — were all invisible in the code.

---

## 14. Cost and rate limits

All three AI routes use `claude-sonnet-5` (1M context). Rough per-invocation cost:

| Action | Typical cost |
|---|---|
| Assistant message | cents |
| e-MRI Scan (search + fetch + verify) | ~$0.05–0.20 |
| Full 6-bank refresh | ~$1–3 |

Caps in place: chat 4 tool iterations / 60s; discover 10 iterations / 300s; refresh 6 pause-iterations per bank, 120s each. `web_fetch` is capped at `max_content_tokens: 40000` so a 300-page annual report can't dominate the window or the bill.

**The API routes are unauthenticated** — see §10.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **CET1** | Common Equity Tier 1 ratio — core capital ÷ risk-weighted assets. The headline capital measure |
| **TLAC** | Total Loss-Absorbing Capacity — capital plus bail-inable debt |
| **LCR** | Liquidity Coverage Ratio — high-quality liquid assets vs 30-day stressed outflows |
| **NSFR** | Net Stable Funding Ratio — stable funding vs required stable funding over one year |
| **IRRBB** | Interest Rate Risk in the Banking Book. ΔEVE = economic-value sensitivity; ΔNII = 12-month earnings sensitivity |
| **D-SIB** | Domestic Systemically Important Bank — the six here |
| **OSFI** | Office of the Superintendent of Financial Institutions — the Canadian regulator |
| **DSB** | Domestic Stability Buffer — OSFI's variable capital add-on (currently 3.0%) |
| **Pillar 3** | Basel disclosure regime; the supplementary regulatory capital packs |
| **LICAT** | Life Insurance Capital Adequacy Test — the insurance analogue, seen in e-MRI Scan examples |
| **Source ref** | This app's record of exactly where a figure came from |
| **Evidence pack** | The exported audit bundle — PDF + CSV + JSON |
| **Pack ID** | Deterministic hash of a pack's scope; identifies a pack across its three files |

---

## Closing note for the next owner

The charts are the easy part. What is genuinely hard — and genuinely worth preserving — is that **every number is traceable and the app admits what it doesn't know.**

That property is fragile in a specific way: it degrades silently. A loosened matcher, a value carried forward "just this once", a rank ordering that flatters the home bank — none of these throw an error, and all of them look fine until someone checks. Nobody notices the day it breaks; they notice the day a judge, an auditor, or a Managing Director opens the source and finds the number isn't there.

When in doubt, show less and say why.
