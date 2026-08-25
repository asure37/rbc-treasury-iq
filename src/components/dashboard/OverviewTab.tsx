"use client";

import { useMemo, useState } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "./KpiCard";
import { RankHeatmap } from "./RankHeatmap";
import { getMetricSeries, peerAverage } from "@/lib/analytics";
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
    keys: ["lcr", "nsfr", "loanToDepositRatio", "loansToAssetsPct", "retailDepositsPct", "wholesaleFundingPct"],
  },
  {
    label: "Profitability",
    accent: "#ffc72c",
    keys: [
      "roe",
      "roa",
      "rotce",
      "nim",
      "adjustedEfficiencyRatio",
      "adjustedOperatingLeverage",
      "dividendPayoutRatio",
      "adjustedDilutedEps",
      "netIncomeMillions",
    ],
  },
];

const OVERVIEW_METRICS: MetricKey[] = SECTORS.flatMap((s) => s.keys);

export function OverviewTab() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const focusMetric = useDashboardStore((s) => s.focusMetric);

  const home = banks.find((b) => b.isHomeInstitution) ?? banks[0];

  // The dropdown lists every period ANY bank has reported (getAllPeriods in
  // src/lib/data.ts is a union across banks), so a quarter another bank has already
  // published is selectable here even before the home institution has. The page
  // defaults to that global latest too: if RBC hasn't reported it yet, the
  // "hasn't reported" state below is exactly what should greet a reader by
  // default -- it's the truthful answer to "what's the most current quarter."
  const globalLatestPeriod = periods[periods.length - 1]?.period;
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const period = selectedPeriod ?? globalLatestPeriod;
  const isLatest = period === globalLatestPeriod;
  const periodsNewestFirst = [...periods].reverse();
  const periodEnd = periods.find((p) => p.period === period)?.periodEnd;

  // The home institution's own record for the SELECTED period, found by exact period
  // match -- not "most recent quarter with a value," which would silently substitute
  // an older quarter when the selected one simply hasn't been reported yet.
  const homeQuarter = home?.quarters.find((q) => q.period === period);
  const homeQuarterIndex = home?.quarters.findIndex((q) => q.period === period) ?? -1;
  const notYetReported = !!home && !!period && !homeQuarter;

  const cards = useMemo(() => {
    if (!home || !homeQuarter) return [];
    const prevQuarter = homeQuarterIndex > 0 ? home.quarters[homeQuarterIndex - 1] : undefined;
    return OVERVIEW_METRICS.map((key) => {
      const meta = metricsMeta.find((m) => m.key === key)!;
      const fullSeries = getMetricSeries(home, key);
      // Trim the sparkline to the selected quarter so it never shows periods beyond
      // what's being displayed as "current."
      const history = periodEnd ? fullSeries.filter((p) => p.periodEnd <= periodEnd) : fullSeries;
      const value = homeQuarter.metrics[key] ?? null;
      const prevValue = prevQuarter?.metrics[key] ?? null;
      const qoq = value != null && prevValue != null ? value - prevValue : null;
      const avg = peerAverage(banks, key, period, home.bankId);
      const derived = homeQuarter.derived?.[key] === true;
      const offBasis = homeQuarter.offBasis?.[key] === true;
      return { meta, value, qoq, avg, history, derived, offBasis };
    }).filter((c) => c.meta);
  }, [home, homeQuarter, homeQuarterIndex, periodEnd, period, banks, metricsMeta]);

  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.meta.key, c])), [cards]);

  if (!home) {
    return (
      <GlassCard className="p-8 text-center text-text-muted">
        No bank data available yet. Once the ingestion agents finish writing to{" "}
        <code className="text-rbc-cyan">/data/banks/*.json</code>, this dashboard will populate automatically.
      </GlassCard>
    );
  }

  const periodSelector = (
    <div className="flex items-center gap-2">
      <select
        value={period ?? ""}
        onChange={(e) => setSelectedPeriod(e.target.value)}
        aria-label="Select quarter"
        className="rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-rbc-cyan/60"
      >
        {periodsNewestFirst.map((p) => (
          <option key={p.period} value={p.period}>
            {p.period}
          </option>
        ))}
      </select>
      {!isLatest && (
        <button
          onClick={() => setSelectedPeriod(null)}
          className="rounded-full border border-rbc-cyan/30 bg-rbc-cyan/10 px-2.5 py-1 text-xs font-medium text-rbc-cyan transition-colors hover:bg-rbc-cyan/20"
        >
          Latest
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-6" glow>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Home Institution</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-text-primary">{home.bankName}</h2>
          {notYetReported ? (
            <p className="mt-0.5 text-sm text-text-muted">
              {home.bankName} hasn&apos;t reported <span className="text-text-secondary">{period}</span> yet.
              This page will populate automatically as soon as it does.
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-text-muted">
              Reported period: <span className="text-text-secondary">{homeQuarter?.period}</span> &middot;{" "}
              <a href={homeQuarter?.reportUrl} target="_blank" rel="noreferrer" className="text-rbc-cyan hover:underline">
                {homeQuarter?.reportName}
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {periodSelector}
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-text-muted">Total Assets</p>
              <p className="font-display text-xl font-semibold text-text-primary">
                {homeQuarter?.metrics.totalAssetsBillions != null
                  ? `$${homeQuarter.metrics.totalAssetsBillions.toLocaleString()}B`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Net Income (Q)</p>
              <p className="font-display text-xl font-semibold text-text-primary">
                {homeQuarter?.metrics.netIncomeMillions != null
                  ? `$${homeQuarter.metrics.netIncomeMillions.toLocaleString()}M`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {notYetReported ? (
        <GlassCard className="p-8 text-center text-text-muted">
          <p className="font-display text-base font-semibold text-text-primary">
            {home.bankName} hasn&apos;t released {period} results yet.
          </p>
          <p className="mt-1 text-sm">
            Select a different quarter above, or check back after the report is published — no further action is
            needed here once it lands.
          </p>
        </GlassCard>
      ) : (
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
                      derived={c.derived}
                      offBasis={c.offBasis}
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
      )}

      <RankHeatmap />
    </div>
  );
}
