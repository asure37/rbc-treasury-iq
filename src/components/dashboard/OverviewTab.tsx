"use client";

import { useMemo } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "./KpiCard";
import { RankHeatmap } from "./RankHeatmap";
import { getMetricSeries, latestQuarterWith, peerAverage, computeQoQChanges } from "@/lib/analytics";
import { GlassCard } from "@/components/ui/GlassCard";
import type { MetricKey } from "@/types/metrics";

// The Overview is a complete scoreboard, grouped by family and shown side by side so a
// reader can take in a whole discipline at once rather than scanning a flat grid.
const SECTORS: { label: string; accent: string; keys: MetricKey[] }[] = [
  {
    label: "Capital",
    accent: "#0066cc",
    keys: [
      "cet1Ratio",
      "tier1CapitalRatio",
      "totalCapitalRatio",
      "leverageRatio",
      "tlacRatio",
      "tlacLeverageRatio",
      "equityMultiplier",
    ],
  },
  {
    label: "Liquidity & Funding",
    accent: "#00b6f1",
    keys: ["lcr", "nsfr", "loanToDepositRatio", "wholesaleFundingPct", "retailDepositsPct", "loansToAssetsPct"],
  },
  {
    label: "Profitability",
    accent: "#ffc72c",
    keys: [
      "roe",
      "roa",
      "rotce",
      "nim",
      "efficiencyRatio",
      "adjustedOperatingLeverage",
      "dividendPayoutRatio",
      "netIncomeMillions",
    ],
  },
];

const OVERVIEW_METRICS: MetricKey[] = SECTORS.flatMap((s) => s.keys);

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

  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.meta.key, c])), [cards]);

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

      <div className="grid gap-4 lg:grid-cols-3">
        {SECTORS.map((sector, si) => {
          const sectorCards = sector.keys.map((k) => cardByKey.get(k)).filter((c) => c != null);
          if (!sectorCards.length) return null;
          return (
            <GlassCard key={sector.label} className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: sector.accent }} />
                <h3 className="font-display text-sm font-semibold text-text-primary">{sector.label}</h3>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-text-muted">
                  {sectorCards.length} metric{sectorCards.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {sectorCards.map((c, i) => (
                  <KpiCard
                    key={c.meta.key}
                    meta={c.meta}
                    value={c.value}
                    qoqDelta={c.qoq}
                    peerAvg={c.avg}
                    history={c.history}
                    delay={si * 0.06 + i * 0.03}
                    active={focusMetric === c.meta.key}
                    onClick={() => {
                      setFocusMetric(c.meta.key);
                      setActiveTab("trends");
                    }}
                  />
                ))}
              </div>
            </GlassCard>
          );
        })}
      </div>

      <RankHeatmap />
    </div>
  );
}
