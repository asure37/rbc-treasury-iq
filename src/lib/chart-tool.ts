import type { MetricMeta } from "@/types/metrics";
import type { ChartSpec, ChartType } from "@/types/chart-spec";

const CHART_TYPES: ChartType[] = ["trend_line", "peer_bar", "radar", "share_pie", "bubble"];

// Custom (client-executed) tool: the model only ever chooses *what* to show —
// it never supplies numeric data. The server validates the call against the
// real dataset below, and the client resolves the final spec against its own
// live copy of the same dataset before rendering.
export const RENDER_CHART_TOOL = {
  name: "render_chart",
  description:
    "Render a chart to visually support your answer. Use it when a visual comparison, trend, or distribution would genuinely clarify the answer for a treasury analyst — e.g. ranking banks on a metric, showing a trend over several quarters, comparing multiple metrics at once, showing relative balance-sheet/earnings share, or plotting two metrics against each other. Do not use it for simple single-number lookups where a sentence suffices. Only reference metric keys, bank ids, and periods that exist in the dataset provided in the system prompt.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      chartType: {
        type: "string",
        enum: CHART_TYPES,
        description:
          "trend_line: one metric over time for selected banks (line chart). peer_bar: one metric ranked across banks for a single period (bar chart). radar: 3-8 metrics normalized 0-100 across banks for a single period (radar/spider chart). share_pie: one metric's share of the peer-group total for a single period — best for totalAssetsBillions or netIncomeMillions (donut chart). bubble: two metrics plotted against each other with a third as bubble size, for a single period (scatter chart).",
      },
      title: { type: "string", description: "Short descriptive chart title, e.g. 'CET1 Ratio — 8-Quarter Trend'." },
      metricKey: {
        type: "string",
        description: "Primary metric key. Required for trend_line, peer_bar, share_pie. Used as the x-axis metric for bubble.",
      },
      yMetricKey: { type: "string", description: "Y-axis metric key. Required only for bubble charts." },
      sizeMetricKey: { type: "string", description: "Bubble-size metric key. Required only for bubble charts (commonly totalAssetsBillions)." },
      metricKeys: {
        type: "array",
        items: { type: "string" },
        description: "3-8 metric keys to plot. Required only for radar charts.",
      },
      bankIds: {
        type: "array",
        items: { type: "string" },
        description: "Bank ids to include (e.g. ['rbc','td']). Omit or leave empty to include all six banks.",
      },
      period: {
        type: "string",
        description: "Single fiscal period like 'Q2 2026'. Used by peer_bar, radar, share_pie, bubble. Omit to use the latest available period.",
      },
      periods: {
        type: "array",
        items: { type: "string" },
        description: "Fiscal periods, oldest to newest. Used only by trend_line. Omit to use all available periods.",
      },
    },
    required: ["chartType", "title"] as string[],
    additionalProperties: false,
  },
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Turns the model's raw tool-call input into a safe ChartSpec, or null if it
 * doesn't reference real metrics/banks/periods. Never trusts the input as-is.
 */
export function buildChartSpecFromToolInput(
  input: unknown,
  metrics: MetricMeta[],
  validPeriods: string[],
  validBankIds: string[]
): ChartSpec | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;

  const chartType = raw.chartType;
  if (typeof chartType !== "string" || !CHART_TYPES.includes(chartType as ChartType)) return null;
  if (!isNonEmptyString(raw.title)) return null;

  const metricKeySet = new Set<string>(metrics.map((m) => m.key));
  const validateMetric = (v: unknown): string | undefined => (isNonEmptyString(v) && metricKeySet.has(v) ? v : undefined);

  const validateBankIds = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const filtered = v.filter((id): id is string => isNonEmptyString(id) && validBankIds.includes(id));
    return filtered.length ? filtered : undefined;
  };

  const validatePeriod = (v: unknown): string | undefined => (isNonEmptyString(v) && validPeriods.includes(v) ? v : undefined);

  const validatePeriods = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const filtered = v.filter((p): p is string => isNonEmptyString(p) && validPeriods.includes(p));
    return filtered.length ? filtered : undefined;
  };

  const spec: ChartSpec = {
    chartType: chartType as ChartType,
    title: raw.title,
    metricKey: validateMetric(raw.metricKey),
    yMetricKey: validateMetric(raw.yMetricKey),
    sizeMetricKey: validateMetric(raw.sizeMetricKey),
    metricKeys: Array.isArray(raw.metricKeys) ? raw.metricKeys.filter((k) => validateMetric(k)) : undefined,
    bankIds: validateBankIds(raw.bankIds),
    period: validatePeriod(raw.period),
    periods: validatePeriods(raw.periods),
  };

  if ((spec.chartType === "trend_line" || spec.chartType === "peer_bar" || spec.chartType === "share_pie") && !spec.metricKey) {
    return null;
  }
  if (spec.chartType === "bubble" && (!spec.metricKey || !spec.yMetricKey || !spec.sizeMetricKey)) {
    return null;
  }
  if (spec.chartType === "radar" && (!spec.metricKeys || spec.metricKeys.length < 3)) {
    return null;
  }

  return spec;
}
