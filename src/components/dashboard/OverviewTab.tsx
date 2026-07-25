"use client";

import { useMemo } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "./KpiCard";
import { RankHeatmap } from "./RankHeatmap";
import { getMetricSeries, latestQuarterWith, peerAverage, computeQoQChanges } from "@/lib/analytics";
import { GlassCard } from "@/components/ui/GlassCard";
import type { MetricKey } from "@/types/metrics";

const OVERVIEW_METRICS: MetricKey[] = [
  "cet1Ratio",
  "totalCapitalRatio",
  "tlacRatio",
  "leverageRatio",
  "lcr",
  "nsfr",
  "roe",
  "nim",
  "efficiencyRatio",
  "loansToAssetsPct",
];

export function OverviewTab() {
  const { banks, metricsMeta } = useDashboardData();
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const focusMetric = useDashboardStore((s) => s.focusMetric);

  const home = banks.find((b) => b.isHomeInstitution) ?? banks[0];

  const cards = useMemo(() => {
    if (!home) return [];
    return OVERVIEW_METRICS.map((key) => {
      const meta = metricsMeta.find((m) => m.key === key)!;
      const series = getMetricSeries(home, key);
      const latestQ = latestQuarterWith(home, key);
      const value = latestQ?.metrics[key] ?? null;
      const changes = computeQoQChanges(home, key);
      const qoq = changes.length ? changes[changes.length - 1].delta : null;
      const avg = latestQ ? peerAverage(banks, key, latestQ.period, home.bankId) : null;
      return { meta, value, qoq, avg, history: series };
    }).filter((c) => c.meta);
  }, [home, banks, metricsMeta]);

  if (!home) {
    return (
      <GlassCard className="p-8 text-center text-text-muted">
        No bank data available yet. Once the ingestion agents finish writing to{" "}
        <code className="text-rbc-cyan">/data/banks/*.json</code>, this dashboard will populate automatically.
      </GlassCard>
    );
  }

  const latest = home.quarters[home.quarters.length - 1];

  return (
    <div className="space-y-6">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-6" glow>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Home Institution</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-text-primary">{home.bankName}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Latest reported period: <span className="text-text-secondary">{latest?.period}</span> &middot;{" "}
            <a href={latest?.reportUrl} target="_blank" rel="noreferrer" className="text-rbc-cyan hover:underline">
              {latest?.reportName}
            </a>
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-xs text-text-muted">Total Assets</p>
            <p className="font-display text-xl font-semibold text-text-primary">
              ${latest?.metrics.totalAssetsBillions?.toLocaleString() ?? "—"}B
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Net Income (Q)</p>
            <p className="font-display text-xl font-semibold text-text-primary">
              ${latest?.metrics.netIncomeMillions?.toLocaleString() ?? "—"}M
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <KpiCard
            key={c.meta.key}
            meta={c.meta}
            value={c.value}
            qoqDelta={c.qoq}
            peerAvg={c.avg}
            history={c.history}
            delay={i * 0.04}
            active={focusMetric === c.meta.key}
            onClick={() => {
              setFocusMetric(c.meta.key);
              setActiveTab("trends");
            }}
          />
        ))}
      </div>

      <RankHeatmap />
    </div>
  );
}
