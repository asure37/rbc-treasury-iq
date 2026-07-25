import type { BankData, MetricKey, MetricMeta, QuarterMetrics } from "@/types/metrics";
import type { QuarterId, SanityFlag } from "@/lib/quarters";

// Plausible value ranges per metric, used to reject obviously-wrong extractions
// (a fat-fingered decimal, a figure in the wrong unit, etc.) before a human
// ever sees them.
const RANGE: Partial<Record<MetricKey, [number, number]>> = {
  cet1Ratio: [5, 25],
  tier1CapitalRatio: [5, 30],
  totalCapitalRatio: [8, 35],
  leverageRatio: [2, 10],
  tlacRatio: [15, 45],
  lcr: [90, 260],
  nsfr: [90, 200],
  roe: [-10, 40],
  nim: [0.5, 5],
  efficiencyRatio: [30, 90],
  loansToAssetsPct: [20, 80],
  totalAssetsBillions: [200, 5000],
  netIncomeMillions: [-20000, 20000],
  loanToDepositRatio: [40, 130],
  wholesaleFundingPct: [5, 50],
  retailDepositsPct: [10, 90],
  wholesaleDepositsPct: [10, 90],
  stableDepositsPct: [3, 70],
  lessStableDepositsPct: [3, 70],
  operationalDepositsPct: [3, 70],
  nonOperationalDepositsPct: [3, 70],
  irrbbEveSensitivityPct: [-20, 20],
  irrbbNiiSensitivityPct: [-20, 20],
};

// A QoQ move larger than this (in the metric's own units) is flagged for human
// review rather than auto-trusted — most of these ratios move by tenths of a
// point per quarter, so a multi-point jump warrants a look.
const LARGE_MOVE: Partial<Record<MetricKey, number>> = {
  cet1Ratio: 1.0,
  tier1CapitalRatio: 1.0,
  totalCapitalRatio: 1.0,
  leverageRatio: 0.5,
  tlacRatio: 2.0,
  lcr: 15,
  nsfr: 8,
  roe: 4,
  nim: 0.25,
  efficiencyRatio: 5,
  loansToAssetsPct: 4,
  totalAssetsBillions: 250,
  netIncomeMillions: 2500,
  loanToDepositRatio: 6,
  wholesaleFundingPct: 6,
  retailDepositsPct: 6,
  wholesaleDepositsPct: 6,
  stableDepositsPct: 6,
  lessStableDepositsPct: 6,
  operationalDepositsPct: 6,
  nonOperationalDepositsPct: 6,
  irrbbEveSensitivityPct: 2,
  irrbbNiiSensitivityPct: 2,
};

export function checkSanity(key: MetricKey, value: number | null | undefined, priorValue: number | null | undefined): { flag: SanityFlag; detail?: string } {
  if (value == null) {
    // Only "missing" if the bank normally discloses it (i.e. we had it last quarter).
    return priorValue != null ? { flag: "missing", detail: "Not found this quarter, but disclosed last quarter." } : { flag: "ok" };
  }
  const range = RANGE[key];
  if (range && (value < range[0] || value > range[1])) {
    return { flag: "out-of-range", detail: `Outside the expected ${range[0]}–${range[1]} range.` };
  }
  if (priorValue != null) {
    const move = Math.abs(value - priorValue);
    const threshold = LARGE_MOVE[key];
    if (threshold != null && move > threshold) {
      return { flag: "large-move", detail: `Moved ${(value - priorValue >= 0 ? "+" : "")}${(value - priorValue).toFixed(2)} vs. last quarter — worth verifying.` };
    }
  }
  return { flag: "ok" };
}

// Serialize the two most recent quarters as concrete examples so the model
// reproduces exactly the shape, units, sourcing style and note conventions we
// already use — reducing format drift quarter over quarter.
function priorQuartersExample(bank: BankData): string {
  const recent = bank.quarters.slice(-2).map((q) => ({
    period: q.period,
    periodEnd: q.periodEnd,
    reportName: q.reportName,
    reportUrl: q.reportUrl,
    metrics: q.metrics,
    notes: q.notes,
  }));
  return JSON.stringify(recent, null, 2);
}

export function buildExtractionPrompt(bank: BankData, target: QuarterId, metricsMeta: MetricMeta[]): string {
  const latest = bank.quarters[bank.quarters.length - 1];
  const metricGlossary = metricsMeta
    .map((m) => `- ${m.key} (${m.label}, unit ${m.unit}): ${m.description}`)
    .join("\n");

  return `You are a treasury data analyst updating a peer-benchmarking dashboard for ${bank.bankName} (${bank.ticker}). The bank's fiscal year ends October 31.

TASK: Find ${bank.bankName}'s disclosures for the fiscal quarter **${target.period}** (quarter ended ${target.periodEnd}) and extract the metrics listed below. Then reply with a single JSON object (and nothing after it) in the exact shape shown at the end.

HOW TO FIND IT:
- This bank's prior quarterly reports were at URLs like: ${latest.reportUrl}
  (and supplementary: ${latest.supplementaryReportUrl ?? "n/a"}). The new quarter's report is almost always at an analogous URL — try the analogous path first with web_fetch, then use web_search for "${bank.bankName} ${target.period} report to shareholders" / "quarterly results" / "supplementary regulatory capital disclosure" if needed.
- Prefer the bank's own Report to Shareholders / MD&A / Supplementary Regulatory Capital Disclosure / Annual Report (for Q4) as the primary source, matching how prior quarters were sourced.

CRITICAL RULES:
- If ${target.period} has NOT been reported yet (the quarter is too recent, or you cannot find a genuine primary-source disclosure), do NOT guess. Return {"status":"not-available","reason":"..."}.
- NEVER fabricate or estimate a number. Only report figures you actually found in a real disclosure. Use null for any metric you cannot find.
- Match the definitions and computation methods used in the prior-quarter examples exactly (some metrics are computed, e.g. loanToDepositRatio = gross loans / total deposits — replicate that method and show your inputs in the note).
- Percentages as plain numbers (13.5 not 0.135). Dollar metrics: totalAssetsBillions in billions, netIncomeMillions in millions.

METRICS TO EXTRACT:
${metricGlossary}

PRIOR TWO QUARTERS FOR THIS BANK (match this structure, sourcing style, and note conventions exactly):
${priorQuartersExample(bank)}

RESPOND WITH EXACTLY ONE JSON OBJECT, no prose before or after, in this shape:
{
  "status": "proposed",
  "period": "${target.period}",
  "periodEnd": "${target.periodEnd}",
  "reportName": "<primary source report name>",
  "reportUrl": "<primary source URL>",
  "metrics": { "cet1Ratio": 0.0, "...": 0.0 },
  "notes": { "cet1Ratio": "<source/computation note>", "...": "..." }
}
Or, if not yet reported: {"status":"not-available","reason":"..."}`;
}

interface ExtractionResult {
  status: "proposed" | "not-available";
  reason?: string;
  period?: string;
  periodEnd?: string;
  reportName?: string;
  reportUrl?: string;
  metrics?: Record<string, number | null>;
  notes?: Record<string, string>;
}

// Pull the model's final JSON object out of its reply, tolerating a fenced
// code block or surrounding prose.
export function parseExtraction(text: string): ExtractionResult | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ExtractionResult;
  } catch {
    return null;
  }
}

export function coerceMetrics(raw: Record<string, number | null> | undefined, metricsMeta: MetricMeta[]): Partial<Record<MetricKey, number | null>> {
  const validKeys = new Set(metricsMeta.map((m) => m.key));
  const out: Partial<Record<MetricKey, number | null>> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!validKeys.has(k as MetricKey)) continue;
    if (v == null) {
      out[k as MetricKey] = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k as MetricKey] = v;
    }
  }
  return out;
}

// Build the QuarterMetrics object that will be appended to the bank file when
// the analyst applies an update, deriving sourceRefs (full-doc search text)
// the same way the rest of the dashboard links figures to their source.
export function buildQuarterMetrics(
  target: QuarterId,
  reportName: string,
  reportUrl: string,
  metrics: Partial<Record<MetricKey, number | null>>,
  notes: Partial<Record<MetricKey, string>>,
  metricsMeta: MetricMeta[],
): QuarterMetrics {
  const sourceRefs: QuarterMetrics["sourceRefs"] = {};
  for (const m of metricsMeta) {
    const v = metrics[m.key];
    if (v == null) continue;
    const formatted = m.unit === "%" ? v.toFixed(m.decimals) : undefined;
    if (formatted) sourceRefs[m.key] = { url: reportUrl, searchText: formatted };
  }
  return {
    period: target.period,
    periodEnd: target.periodEnd,
    reportName,
    reportUrl,
    retrievedAt: new Date().toISOString(),
    metrics,
    notes,
    sourceRefs,
  };
}
