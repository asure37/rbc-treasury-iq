# RBC Treasury Intelligence

A peer-benchmarking dashboard comparing **RBC against the five other Canadian D-SIBs** — TD, Scotiabank, BMO, CIBC and National Bank — across 23 capital, liquidity, funding, profitability and interest-rate-risk metrics, over eight quarters.

**Every number on screen is clickable and traces to the page of the disclosure it came from.** Click a figure and the source PDF opens at the right page with the exact number highlighted.

Built for the RBC CFO Group Student Ambitious Ideas Competition by *Trustees of Treasury*.

**Live:** https://rbc-treasury-iq.onrender.com — login `ctocmembers` / `rbc`

---

## New here? Read [HANDBOOK.md](./HANDBOOK.md)

The handbook is the real documentation — architecture, data model, the lineage system, runbooks for common changes, known traps, and the verification playbook. This README only gets you running.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then paste a real ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Without an API key everything works except the three AI routes (assistant, e-MRI Scan, quarterly refresh), which return a clean 503.

## Before every commit

```bash
npm run check
```

Runs `tsc --noEmit`, `eslint src` and `next build` — all three must be clean. There is no test suite; the project verifies against reality instead. Two scripts do that work:

```bash
npm run stats     # dataset coverage — every number quoted in the handbook
npm run probe     # re-resolves all 1,034 citations against their real PDFs
```

`npm run probe` is the one that matters. It re-opens every cited document and checks that each figure still highlights on the page it claims — see [§13 of the handbook](./HANDBOOK.md#13-verification-playbook). First run needs `-- --download` to fetch the PDFs.

## The one rule that matters

> **Never fabricate, estimate, or interpolate a metric.** Every figure either traces to a real, cited public disclosure, or it stays `null` and the UI says so.

This is the product's entire claim. A single invented number destroys the credibility of all 1,093 of them.

## Layout

```
src/app/          routes + 7 API endpoints
src/components/   auth · dashboard (7 tabs) · charts · chat · ui
src/lib/          all logic that isn't a component
src/types/        metrics.ts — the data model
data/banks/       6 JSON files — the entire dataset
```

Stack: Next.js 16.2 (App Router) · React 19 · TypeScript 5 · Tailwind v4 (no config file — `@theme` in `globals.css`) · Recharts · pdf.js · Anthropic SDK.

Deployed on Render via `render.yaml`; auto-deploys on push to `main`.
