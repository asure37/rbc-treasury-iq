"use client";

import { useState } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { GlassCard } from "@/components/ui/GlassCard";
import { BankFilter } from "./BankFilter";
import { ExpandableChartCard } from "./ExpandableChartCard";
import { IrrbbDisclosureTable } from "./IrrbbDisclosureTable";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { PeerBarChart } from "@/components/charts/PeerBarChart";
import { DepositCompositionChart } from "@/components/charts/DepositCompositionChart";
import type { BankData, MetricKey } from "@/types/metrics";

function findLatestPeriodWithData(banks: BankData[], periods: string[], keys: MetricKey[]): string | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    const hasData = banks.some((b) => {
      const q = b.quarters.find((qq) => qq.period === p);
      return !!q && keys.some((k) => q.metrics[k] != null);
    });
    if (hasData) return p;
  }
  return null;
}

export function FundingTab() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const selectedBankIds = useDashboardStore((s) => s.selectedBankIds);
  const activeBankIds = selectedBankIds.length ? selectedBankIds : banks.map((b) => b.bankId);
  const filteredBanks = banks.filter((b) => activeBankIds.includes(b.bankId));

  const allPeriods = periods.map((p) => p.period);
  const latestPeriod = allPeriods[allPeriods.length - 1];
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const period = selectedPeriod ?? latestPeriod;
  const isLatest = period === latestPeriod;
  const periodsNewestFirst = [...allPeriods].reverse();

  const getMeta = (key: MetricKey) => metricsMeta.find((m) => m.key === key)!;
  const ltdMeta = getMeta("loanToDepositRatio");
  const retailMeta = getMeta("retailDepositsPct");
  const wholesaleDepMeta = getMeta("wholesaleDepositsPct");
  const stableMeta = getMeta("stableDepositsPct");
  const lessStableMeta = getMeta("lessStableDepositsPct");
  const operationalMeta = getMeta("operationalDepositsPct");
  const nonOperationalMeta = getMeta("nonOperationalDepositsPct");
  const eveMeta = getMeta("irrbbEveSensitivityPct");
  const niiMeta = getMeta("irrbbNiiSensitivityPct");

  // IRRBB is now disclosed quarterly by all six banks, so track the selected period; fall back to
  // the latest period that has data only if the selection somehow lacks it.
  const irrbbKeys: MetricKey[] = ["irrbbEveSensitivityPct", "irrbbNiiSensitivityPct"];
  const irrbbPeriod =
    findLatestPeriodWithData(banks, [period], irrbbKeys) ?? findLatestPeriodWithData(banks, allPeriods, irrbbKeys);

  const tickers = filteredBanks.map((b) => b.ticker).join(", ");
  const chartContext = { activeTab: "funding", period, selectedBankIds: activeBankIds };

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={period ?? ""}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-rbc-cyan/60"
          >
            {periodsNewestFirst.map((p) => (
              <option key={p} value={p}>
                {p}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ExpandableChartCard
          title="Loan-to-Deposit Ratio — Trend"
          subtitle={<span className="mb-3 block text-xs text-text-muted">All available quarters</span>}
          context={{ ...chartContext, focusMetric: ltdMeta.key }}
          summaryPrompt={`Summarize the "Loan-to-Deposit Ratio — Trend" chart covering ${tickers}. Explain what the loan-to-deposit ratio measures for treasury funding strategy, and give 2-4 insights about how RBC's ratio has trended and how it compares to peers.`}
          renderExpanded={() => <TrendLineChart banks={filteredBanks} periods={allPeriods} metric={ltdMeta} height={480} />}
        >
          <TrendLineChart banks={filteredBanks} periods={allPeriods} metric={ltdMeta} />
        </ExpandableChartCard>

        <ExpandableChartCard
          title="Retail vs. Wholesale Deposits"
          subtitle={<span className="mb-3 block text-xs text-text-muted">{period}</span>}
          context={{ ...chartContext, focusMetric: retailMeta.key }}
          summaryPrompt={`Summarize the "Retail vs. Wholesale Deposits" chart for ${period}, covering ${tickers}. Explain why the retail/wholesale deposit mix matters for funding stability and give 2-4 insights about how the banks compare.`}
          renderExpanded={() => (
            <DepositCompositionChart banks={filteredBanks} period={period!} metricA={retailMeta} metricB={wholesaleDepMeta} height={480} />
          )}
        >
          {period && <DepositCompositionChart banks={filteredBanks} period={period} metricA={retailMeta} metricB={wholesaleDepMeta} />}
        </ExpandableChartCard>
      </div>

      <GlassCard className="p-5">
        <h3 className="mb-1 font-display text-base font-semibold text-text-primary">Deposit Composition</h3>
        <p className="mb-3 text-xs text-text-muted">
          Each split is shown against its own book, so every bar totals 100% &middot; {period}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpandableChartCard
            title="Stable vs. Less Stable Deposits"
            context={{ ...chartContext, focusMetric: stableMeta.key }}
            summaryPrompt={`Summarize the "Stable vs. Less Stable Deposits" chart for ${period}, covering ${tickers}. Explain the LCR stable/less-stable deposit classification and give 2-4 insights about how the banks compare on deposit stability.`}
            renderExpanded={() => (
              <DepositCompositionChart
                banks={filteredBanks}
                period={period!}
                metricA={stableMeta}
                metricB={lessStableMeta}
                colorA="#2dd4bf"
                colorB="#fb7185"
                height={420}
              />
            )}
          >
            <DepositCompositionChart
              banks={filteredBanks}
              period={period}
              metricA={stableMeta}
              metricB={lessStableMeta}
              colorA="#2dd4bf"
              colorB="#fb7185"
              height={220}
            />
          </ExpandableChartCard>

          <ExpandableChartCard
            title="Operational vs. Non-Operational Deposits"
            context={{ ...chartContext, focusMetric: operationalMeta.key }}
            summaryPrompt={`Summarize the "Operational vs. Non-Operational Deposits" chart for ${period}, covering ${tickers}. Explain the operational deposit classification (and why it earns preferential LCR runoff treatment) and give 2-4 insights about how the banks compare.`}
            renderExpanded={() => (
              <DepositCompositionChart
                banks={filteredBanks}
                period={period!}
                metricA={operationalMeta}
                metricB={nonOperationalMeta}
                colorA="#ffc72c"
                colorB="#8ca0be"
                height={420}
              />
            )}
          >
            <DepositCompositionChart
              banks={filteredBanks}
              period={period}
              metricA={operationalMeta}
              metricB={nonOperationalMeta}
              colorA="#ffc72c"
              colorB="#8ca0be"
              height={220}
            />
          </ExpandableChartCard>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="mb-1 font-display text-base font-semibold text-text-primary">
          Interest Rate Risk in the Banking Book (IRRBB) {irrbbPeriod && <span className="text-text-muted">&middot; {irrbbPeriod}</span>}
        </h3>
        <p className="mb-3 text-xs text-text-muted">
          All six banks disclose a &plusmn;100bp parallel-shock &Delta;EVE / &Delta;NII sensitivity every quarter in their Reports to
          Shareholders (the standardized six-scenario Basel/OSFI template is annual, where disclosed). Values are shown as a % of Tier 1
          capital for comparability — sign and shock direction vary by bank, so check the per-metric notes.
        </p>
        {irrbbPeriod ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ExpandableChartCard
              title="ΔEVE Sensitivity — Most Adverse Scenario"
              subtitle={<span className="mb-3 block text-xs text-text-muted">{irrbbPeriod} &middot; % of Tier 1 capital</span>}
              context={{ activeTab: "funding", period: irrbbPeriod, selectedBankIds: activeBankIds, focusMetric: eveMeta.key }}
              summaryPrompt={`Summarize the "ΔEVE Sensitivity" IRRBB chart for ${irrbbPeriod}, covering ${tickers}. Explain what economic value of equity (EVE) sensitivity measures, the 15% OSFI outlier-test threshold, and give 2-4 insights about how exposed each bank is to interest rate risk.`}
              renderExpanded={() => <PeerBarChart banks={filteredBanks} period={irrbbPeriod} metric={eveMeta} height={480} />}
            >
              <PeerBarChart banks={filteredBanks} period={irrbbPeriod} metric={eveMeta} />
            </ExpandableChartCard>

            <ExpandableChartCard
              title="ΔNII Sensitivity"
              subtitle={<span className="mb-3 block text-xs text-text-muted">{irrbbPeriod} &middot; as disclosed per bank</span>}
              context={{ activeTab: "funding", period: irrbbPeriod, selectedBankIds: activeBankIds, focusMetric: niiMeta.key }}
              summaryPrompt={`Summarize the "ΔNII Sensitivity" IRRBB chart for ${irrbbPeriod}, covering ${tickers}. Explain what net interest income (NII) sensitivity measures and give 2-4 insights, noting that shock size/direction can vary by bank disclosure (check notes/sources).`}
              renderExpanded={() => <PeerBarChart banks={filteredBanks} period={irrbbPeriod} metric={niiMeta} height={480} />}
            >
              <PeerBarChart banks={filteredBanks} period={irrbbPeriod} metric={niiMeta} />
            </ExpandableChartCard>
          </div>
        ) : (
          <p className="text-sm text-text-muted">No IRRBB sensitivity data available yet for the selected banks.</p>
        )}

        <h4 className="mb-2 mt-6 font-display text-sm font-semibold text-text-primary">IRRBB Disclosure Practices vs. Peers</h4>
        <IrrbbDisclosureTable banks={filteredBanks} />
      </GlassCard>
    </div>
  );
}
