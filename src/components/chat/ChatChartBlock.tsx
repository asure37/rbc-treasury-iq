"use client";

import { useDashboardData } from "@/lib/data-context";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { PeerBarChart } from "@/components/charts/PeerBarChart";
import { RadarComparison } from "@/components/charts/RadarComparison";
import { SharePieChart } from "@/components/charts/SharePieChart";
import { CapitalProfitabilityBubble } from "@/components/charts/CapitalProfitabilityBubble";
import type { ChartSpec } from "@/types/chart-spec";
import type { MetricMeta } from "@/types/metrics";

// Resolves a model-authored ChartSpec against the *live* dashboard dataset —
// the model only ever chose what to show; every number rendered here comes
// from the same verified data source as the rest of the dashboard.
export function ChatChartBlock({ spec }: { spec: ChartSpec }) {
  const { banks, metricsMeta, periods } = useDashboardData();
  const allPeriods = periods.map((p) => p.period);
  const latestPeriod = allPeriods[allPeriods.length - 1];

  const getMeta = (key?: string): MetricMeta | undefined => metricsMeta.find((m) => m.key === key);

  const requestedBankIds = spec.bankIds?.filter((id) => banks.some((b) => b.bankId === id));
  const chartBanks = requestedBankIds?.length ? banks.filter((b) => requestedBankIds.includes(b.bankId)) : banks;

  const period = spec.period && allPeriods.includes(spec.period) ? spec.period : latestPeriod;
  const requestedPeriods = spec.periods?.filter((p) => allPeriods.includes(p));
  const trendPeriods = requestedPeriods?.length ? requestedPeriods : allPeriods;

  const metric = getMeta(spec.metricKey);

  const unavailable = (reason: string) => <p className="text-xs text-text-muted">Chart unavailable — {reason}</p>;

  let body: React.ReactNode;
  if (spec.chartType === "trend_line") {
    body = metric ? <TrendLineChart banks={chartBanks} periods={trendPeriods} metric={metric} /> : unavailable("unknown metric");
  } else if (spec.chartType === "peer_bar") {
    body = metric ? <PeerBarChart banks={chartBanks} period={period} metric={metric} /> : unavailable("unknown metric");
  } else if (spec.chartType === "share_pie") {
    body = metric ? <SharePieChart banks={chartBanks} period={period} metric={metric} /> : unavailable("unknown metric");
  } else if (spec.chartType === "radar") {
    const radarMetrics = (spec.metricKeys ?? []).map((k) => getMeta(k)).filter((m): m is MetricMeta => !!m);
    body = radarMetrics.length >= 3 ? <RadarComparison banks={chartBanks} period={period} metrics={radarMetrics} /> : unavailable("need at least 3 valid metrics");
  } else if (spec.chartType === "bubble") {
    const yMetric = getMeta(spec.yMetricKey);
    const sizeMetric = getMeta(spec.sizeMetricKey);
    body = metric && yMetric && sizeMetric ? (
      <CapitalProfitabilityBubble banks={chartBanks} period={period} xMetric={metric} yMetric={yMetric} sizeMetric={sizeMetric} />
    ) : (
      unavailable("missing x/y/size metric")
    );
  } else {
    body = unavailable("unknown chart type");
  }

  return (
    <div className="glass-panel my-1 rounded-xl p-3">
      <h4 className="mb-2 font-display text-xs font-semibold text-text-primary">{spec.title}</h4>
      {body}
    </div>
  );
}
