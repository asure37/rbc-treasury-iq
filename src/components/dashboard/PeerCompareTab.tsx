"use client";

import { useMemo, useState } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { GlassCard } from "@/components/ui/GlassCard";
import { BankFilter } from "./BankFilter";
import { ExpandableChartCard } from "./ExpandableChartCard";
import { PeerBarChart } from "@/components/charts/PeerBarChart";
import { RadarComparison } from "@/components/charts/RadarComparison";
import { SharePieChart } from "@/components/charts/SharePieChart";
import { CapitalProfitabilityBubble } from "@/components/charts/CapitalProfitabilityBubble";
import { ValuationBubble } from "@/components/charts/ValuationBubble";
import { CreditRatingsSection } from "./CreditRatingsSection";
import { peerAverage } from "@/lib/analytics";
import type { MetricKey } from "@/types/metrics";

const RADAR_METRICS: MetricKey[] = ["cet1Ratio", "totalCapitalRatio", "leverageRatio", "roe", "nim", "efficiencyRatio", "lcr"];
const RANK_METRICS: MetricKey[] = ["cet1Ratio", "totalCapitalRatio", "tlacRatio", "leverageRatio", "lcr", "nsfr", "roe", "nim"];

export function PeerCompareTab() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const focusMetric = useDashboardStore((s) => s.focusMetric);
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const selectedBankIds = useDashboardStore((s) => s.selectedBankIds);

  const meta = metricsMeta.find((m) => m.key === focusMetric) ?? metricsMeta[0];
  const activeBankIds = selectedBankIds.length ? selectedBankIds : banks.map((b) => b.bankId);
  const filteredBanks = banks.filter((b) => activeBankIds.includes(b.bankId));

  const latestPeriod = periods[periods.length - 1]?.period;
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const period = selectedPeriod ?? latestPeriod;
  const isLatest = period === latestPeriod;
  const periodsNewestFirst = [...periods].reverse();

  const radarMeta = metricsMeta.filter((m) => RADAR_METRICS.includes(m.key));
  const assetsMeta = metricsMeta.find((m) => m.key === "totalAssetsBillions")!;
  const netIncomeMeta = metricsMeta.find((m) => m.key === "netIncomeMillions")!;
  const cet1Meta = metricsMeta.find((m) => m.key === "cet1Ratio")!;
  const roeMeta = metricsMeta.find((m) => m.key === "roe")!;

  const tickers = filteredBanks.map((b) => b.ticker).join(", ");
  const chartContext = { activeTab: "peers", period, selectedBankIds: activeBankIds };

  const rankings = useMemo(() => {
    const home = banks.find((b) => b.isHomeInstitution);
    if (!home || !period) return [];
    return RANK_METRICS.map((key) => {
      const m = metricsMeta.find((mm) => mm.key === key)!;
      const homeQ = home.quarters.find((q) => q.period === period);
      const value = homeQ?.metrics[key] ?? null;
      const avg = peerAverage(banks, key, period, home.bankId);
      const sorted = banks
        .map((b) => ({ id: b.bankId, v: b.quarters.find((q) => q.period === period)?.metrics[key] }))
        .filter((r) => r.v != null)
        .sort((a, b) => (m.higherIsBetter === false ? a.v! - b.v! : b.v! - a.v!));
      const rank = sorted.findIndex((r) => r.id === home.bankId) + 1;
      return { meta: m, value, avg, rank, total: sorted.length };
    });
  }, [banks, metricsMeta, period]);

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={focusMetric}
            onChange={(e) => setFocusMetric(e.target.value as MetricKey)}
            className="rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-rbc-cyan/60"
          >
            {metricsMeta.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            value={period ?? ""}
            onChange={(e) => setSelectedPeriod(e.target.value)}
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
              Jump to latest
            </button>
          )}
        </div>
        <BankFilter />
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="mb-4 font-display text-base font-semibold text-text-primary">RBC Standing vs. Peer Average &mdash; {period}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {rankings.map((r) => (
            <div key={r.meta.key} className="rounded-xl border border-border-soft bg-surface/50 p-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{r.meta.shortLabel}</p>
              <p className="mt-1 font-display text-lg font-bold text-text-primary tabular-nums">
                {r.value != null ? `${r.value.toFixed(r.meta.decimals)}${r.meta.unit === "%" ? "%" : ""}` : "—"}
              </p>
              <p className="text-[11px] text-text-muted">
                Rank <span className="font-semibold text-rbc-cyan">{r.rank || "—"}</span>/{r.total} &middot; avg{" "}
                {r.avg?.toFixed(r.meta.decimals) ?? "—"}
              </p>
            </div>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpandableChartCard
          title={`${meta.label} — Peer Ranking`}
          subtitle={<span className="mb-3 block text-xs text-text-muted">{period}</span>}
          context={{ ...chartContext, focusMetric: meta.key }}
          summaryPrompt={`Summarize the "${meta.label} — Peer Ranking" chart for ${period}, covering ${tickers}. Explain what this chart shows, how the ranking is determined, and give 2-4 concrete insights an analyst should take away about how RBC compares to peers on this metric.`}
          renderExpanded={() => <PeerBarChart banks={filteredBanks} period={period!} metric={meta} height={560} />}
        >
          {period && <PeerBarChart banks={filteredBanks} period={period} metric={meta} />}
        </ExpandableChartCard>

        <ExpandableChartCard
          title="Multi-Metric Profile (normalized)"
          subtitle={<span className="mb-3 block text-xs text-text-muted">{period}</span>}
          context={{ ...chartContext, focusMetric: meta.key }}
          summaryPrompt={`Summarize the "Multi-Metric Profile" radar chart for ${period}, which normalizes these metrics on a 0-100 scale (per-axis min/max across the shown banks) for ${tickers}: ${radarMeta.map((m) => m.label).join(", ")}. Explain what a normalized radar profile represents — each axis is scaled independently so shape/coverage matters more than absolute position — and give 2-4 insights about how the banks compare across these dimensions.`}
          renderExpanded={() => <RadarComparison banks={filteredBanks} period={period!} metrics={radarMeta} height={520} />}
        >
          {period && <RadarComparison banks={filteredBanks} period={period} metrics={radarMeta} />}
        </ExpandableChartCard>
      </div>

      <CreditRatingsSection />

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpandableChartCard
          title="Balance Sheet Scale"
          subtitle={<p className="mb-2 text-xs text-text-muted">Share of combined peer-group total assets &middot; {period}</p>}
          context={{ ...chartContext, focusMetric: assetsMeta.key }}
          summaryPrompt={`Summarize the "Balance Sheet Scale" chart for ${period}, showing each bank's share of combined peer-group total assets among ${tickers}. Explain what it shows and give 2-4 insights about relative bank size and what that might imply for balance-sheet/treasury strategy.`}
          renderExpanded={() => <SharePieChart banks={filteredBanks} period={period!} metric={assetsMeta} height={420} />}
        >
          {period && <SharePieChart banks={filteredBanks} period={period} metric={assetsMeta} />}
        </ExpandableChartCard>

        <ExpandableChartCard
          title="Earnings Share"
          subtitle={<p className="mb-2 text-xs text-text-muted">Share of combined peer-group quarterly net income &middot; {period}</p>}
          context={{ ...chartContext, focusMetric: netIncomeMeta.key }}
          summaryPrompt={`Summarize the "Earnings Share" chart for ${period}, showing each bank's share of combined peer-group quarterly net income among ${tickers}. Explain what it shows and give 2-4 insights, including whether any bank's earnings share looks out of proportion to its balance-sheet share (i.e. punching above/below its size in profitability).`}
          renderExpanded={() => <SharePieChart banks={filteredBanks} period={period!} metric={netIncomeMeta} height={420} />}
        >
          {period && <SharePieChart banks={filteredBanks} period={period} metric={netIncomeMeta} />}
        </ExpandableChartCard>
      </div>

      <ExpandableChartCard
        title="Capital Strength vs. Profitability"
        subtitle={
          <p className="mb-2 text-xs text-text-muted">
            {cet1Meta.shortLabel} (x) vs. {roeMeta.shortLabel} (y) &middot; bubble size = {assetsMeta.shortLabel} &middot; {period}
          </p>
        }
        context={{ ...chartContext, focusMetric: cet1Meta.key }}
        summaryPrompt={`Summarize the "Capital Strength vs. Profitability" bubble chart for ${period}: x-axis is ${cet1Meta.label}, y-axis is ${roeMeta.label}, bubble size is ${assetsMeta.label}, across ${tickers}. Explain what this chart is illustrating and give 2-4 insights about the relationship between capital strength, profitability, and balance-sheet size across these banks.`}
        renderExpanded={() => (
          <CapitalProfitabilityBubble banks={filteredBanks} period={period!} xMetric={cet1Meta} yMetric={roeMeta} sizeMetric={assetsMeta} height={520} />
        )}
      >
        {period && (
          <CapitalProfitabilityBubble banks={filteredBanks} period={period} xMetric={cet1Meta} yMetric={roeMeta} sizeMetric={assetsMeta} />
        )}
      </ExpandableChartCard>

      <ExpandableChartCard
        title="Valuation — ROE vs. Price-to-Book (live)"
        subtitle={
          <p className="mb-2 text-xs text-text-muted">
            Live TSX price &divide; disclosed book value per share (y) vs. {roeMeta.shortLabel} (x) &middot; bubble size = {assetsMeta.shortLabel} &middot; auto-refreshes each minute
          </p>
        }
        context={{ ...chartContext, focusMetric: roeMeta.key }}
        summaryPrompt={`Summarize the "Valuation — ROE vs. Price-to-Book" bubble chart across ${tickers}: the x-axis is return on equity, the y-axis is the live price-to-book multiple (current TSX share price divided by the disclosed book value per common share), and bubble size is total assets. Explain the classic bank-valuation relationship — banks that earn a higher, more sustainable ROE tend to trade at a higher price-to-book multiple — and give 2-4 insights about which banks look richly or cheaply valued relative to their profitability, including where RBC sits.`}
        renderExpanded={() => <ValuationBubble banks={filteredBanks} height={520} />}
      >
        <ValuationBubble banks={filteredBanks} />
      </ExpandableChartCard>
    </div>
  );
}
