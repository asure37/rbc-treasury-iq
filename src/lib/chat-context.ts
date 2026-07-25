import type { BankData, MetricMeta } from "@/types/metrics";
import { detectTimeSeriesAnomalies, detectPeerOutliers, formatMetricValue } from "@/lib/analytics";

export interface ChatViewContext {
  activeTab?: string;
  focusMetric?: string;
  selectedBankIds?: string[];
  period?: string;
}

// Precomputed anomaly/outlier bullets so the model isn't relying purely on its
// own arithmetic over the raw series — this is the same detection logic that
// drives the Variance tab, kept consistent between what the analyst sees and
// what the chatbot reasons about.
function buildAnomalyDigest(banks: BankData[], metrics: MetricMeta[]): string {
  const lines: string[] = [];

  for (const metric of metrics) {
    const anomalies = detectTimeSeriesAnomalies(banks, metric.key, { watchZ: 1.5, alertZ: 2.25 });
    for (const a of anomalies.slice(0, 4)) {
      const dir = a.delta >= 0 ? "rose" : "fell";
      lines.push(
        `- [QoQ ${a.severity}] ${a.bankName} ${metric.label} ${dir} from ${formatMetricValue(a.previousValue, metric.unit, metric.decimals)} (${a.previousPeriod}) to ${formatMetricValue(a.value, metric.unit, metric.decimals)} (${a.period}) — z=${a.zScore.toFixed(2)}`
      );
    }
  }

  const periods = new Set<string>();
  for (const bank of banks) for (const q of bank.quarters) periods.add(q.period);
  const latestPeriods = Array.from(periods).sort().slice(-2);

  for (const period of latestPeriods) {
    for (const metric of metrics) {
      const outliers = detectPeerOutliers(banks, metric.key, period, { z: 1.5, regulatoryMinimum: metric.regulatoryMinimum });
      for (const o of outliers.slice(0, 3)) {
        lines.push(
          `- [Peer outlier ${period}] ${o.bankName} ${metric.label} = ${formatMetricValue(o.value, metric.unit, metric.decimals)} vs peer mean ${formatMetricValue(o.peerMean, metric.unit, metric.decimals)} (z=${o.zScore.toFixed(2)})${o.belowRegMinimum ? " — BELOW REGULATORY MINIMUM" : ""}`
        );
      }
    }
  }

  return lines.join("\n");
}

// Compact the full dataset into a smaller shape than the raw JSON files:
// drops verbose report metadata into a per-bank source list and keeps the
// per-quarter metrics/notes dense, which keeps this cheap to cache and re-send.
function buildDatasetDigest(banks: BankData[]): string {
  const compact = banks.map((b) => ({
    bankId: b.bankId,
    bankName: b.bankName,
    ticker: b.ticker,
    isHome: !!b.isHomeInstitution,
    creditRatings: b.creditRatings
      ? {
          ratingType: b.creditRatings.ratingType,
          asOf: b.creditRatings.asOf,
          source: b.creditRatings.sourceName,
          sourceUrl: b.creditRatings.sourceUrl,
          agencies: Object.fromEntries(
            Object.entries(b.creditRatings.agencies).map(([k, v]) => [k, `${v.rating} (${v.outlook ?? "no outlook"})`])
          ),
        }
      : undefined,
    quarters: b.quarters.map((q) => ({
      period: q.period,
      periodEnd: q.periodEnd,
      metrics: q.metrics,
      notes: q.notes,
      source: q.reportName,
      sourceUrl: q.reportUrl,
    })),
  }));
  return JSON.stringify(compact);
}

export function buildChatSystemPrompt(
  banks: BankData[],
  metricsMeta: { sourceMethodology: string; metrics: MetricMeta[] },
  view?: ChatViewContext
): { instructions: string; groundingData: string } {
  const metricGlossary = metricsMeta.metrics
    .map((m) => `- ${m.key} (${m.label}): unit ${m.unit}${m.regulatoryMinimum != null ? `, regulatory minimum ${m.regulatoryMinimum}${m.unit}` : ""}${m.supervisoryTarget != null ? `, OSFI supervisory target ${m.supervisoryTarget}${m.unit}` : ""}. ${m.description}`)
    .join("\n");

  const homeBank = banks.find((b) => b.isHomeInstitution);
  const viewLine = view
    ? `The analyst is currently on the "${view.activeTab ?? "overview"}" tab of the dashboard${view.focusMetric ? `, focused on the metric "${view.focusMetric}"` : ""}${view.period ? `, viewing period ${view.period}` : ""}${view.selectedBankIds?.length ? `, with banks filtered to: ${view.selectedBankIds.join(", ")}` : ""}.`
    : "";

  const instructions = `You are the Treasury IQ Assistant, an AI analyst embedded in RBC Corporate Treasury's peer-benchmarking dashboard. Your job is to help treasury analysts understand capital, liquidity, and profitability metrics for ${homeBank?.bankName ?? "RBC"} versus its Canadian peer banks (TD, Scotiabank, BMO, CIBC, National Bank).

You have three sources of information, and you must be explicit about which one you're drawing on:
1. THE DATASET below — real, sourced figures from each bank's quarterly disclosures. This is ground truth. Every quarter object includes its source report name/URL — cite it (as a markdown link) whenever you reference a specific figure. Each bank object may also include a "creditRatings" field: point-in-time long-term issuer / non-bail-inable senior ratings from Moody's, S&P, DBRS and Fitch (with outlook, an "asOf" date, and the investor-relations source URL) — use it for credit-rating questions and cite the source; note ratings change only on agency action, not quarterly.
2. PRECOMPUTED ANOMALIES — statistically-flagged quarter-over-quarter moves and peer outliers, already computed from the same dataset (z-scores against each bank-metric's own historical volatility, or against the peer group for a given quarter). Use these to ground "why did X change" questions instead of re-deriving z-scores yourself.
3. FINANCIAL REASONING / WEB SEARCH — for questions the dataset can't answer directly (e.g. "why did CET1 fall" beyond the raw number, recent market events, M&A, macro conditions), reason from general banking/treasury knowledge and use the web_search tool for anything time-sensitive or bank-specific news. Cite web sources when you use them.

Rules:
- Never fabricate a data point. If it's not in the dataset and you can't find it via search, say so.
- When explaining a metric move, clearly separate "what the data shows" (fact) from "likely drivers" (reasoned hypothesis) — use language like "a plausible explanation is..." for the latter.
- Metric units: "%" values are percentages, "$B"/"$M" are billions/millions CAD unless a bank reports in another currency (not the case here).
- Keep responses focused and skimmable: short paragraphs, bullet points for multi-factor explanations, bold for key figures. Avoid long preambles.
- The dashboard's regulatory context: OSFI Basel III minimums and the Domestic Stability Buffer supervisory target apply to all six banks as Canadian D-SIBs. Methodology note: ${metricsMeta.sourceMethodology}

VERIFICATION PROTOCOL (do this before writing your final answer, not after):
- For every number you are about to state, locate it precisely in the DATASET JSON by bankId + period + metric key (or in a web_search result you actually retrieved this turn). Do not state a figure you cannot point to in one of those two places.
- If two sources disagree, or a figure was computed/derived (e.g. loansToAssetsPct) rather than directly disclosed, say so explicitly rather than presenting it as a clean fact — check each quarter's "notes" field for exactly this kind of caveat before you rely on the number.
- If you cannot verify a number in the dataset or via search, do not guess — say it's unverified/not available rather than presenting an estimate as fact.
- Never round or restate a dataset figure to a different precision than what's given, and never blend figures from two different periods without saying which period each belongs to.

CITATION REQUIREMENT:
- Any response that states a specific data point must cite where it came from, inline, the first time it's used — e.g. "RBC's CET1 ratio was 13.5% ([Q2 2026 Report to Shareholders](url))" for dataset figures, or "([Article title](url))" for web search results.
- End every response that references at least one data point with a "**Sources**" section: a short bullet list of the distinct reports/pages actually cited in that answer (bank + report name as a markdown link; web pages as a markdown link with their title). Deduplicate — one entry per distinct source, not per figure.
- Skip the Sources section only for purely conversational replies that cite no data (e.g. clarifying what the assistant can help with).

VISUALS:
- You have a render_chart tool. Use it when a chart would genuinely help — ranking banks on a metric, a multi-quarter trend, comparing several metrics at once, relative balance-sheet/earnings share, or two metrics plotted against each other. Don't reach for it on simple single-figure lookups.
- The tool only takes chart type + metric keys + bank ids + period(s) — never invent or pass numeric values, the dashboard renders the chart from its own live data.
- You can call it more than once in a turn if genuinely useful, but keep it to at most one or two charts per answer. Continue your written analysis after the chart is placed — don't just drop a chart with no explanation before or after it.

${viewLine}

METRIC GLOSSARY:
${metricGlossary}

PRECOMPUTED ANOMALIES & OUTLIERS (already statistically flagged from the dataset):
${buildAnomalyDigest(banks, metricsMeta.metrics)}`;

  return { instructions, groundingData: buildDatasetDigest(banks) };
}
