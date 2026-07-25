"use client";

import { useState } from "react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { GlassCard } from "@/components/ui/GlassCard";
import { BankFilter } from "./BankFilter";
import { TrendChartPanel } from "./TrendChartPanel";
import type { MetricKey } from "@/types/metrics";

export function TrendsTab() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const focusMetric = useDashboardStore((s) => s.focusMetric);
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const selectedBankIds = useDashboardStore((s) => s.selectedBankIds);
  const periodWindow = useDashboardStore((s) => s.periodWindow);
  const setPeriodWindow = useDashboardStore((s) => s.setPeriodWindow);

  // Second chart has its own metric, independent of the shared focus metric. Default to a
  // metric different from the first so the two panels don't start identical.
  const [secondKey, setSecondKey] = useState<MetricKey>(focusMetric === "roe" ? "nim" : "roe");

  const metaA = metricsMeta.find((m) => m.key === focusMetric) ?? metricsMeta[0];
  const metaB = metricsMeta.find((m) => m.key === secondKey) ?? metricsMeta[0];
  const activeBankIds = selectedBankIds.length ? selectedBankIds : banks.map((b) => b.bankId);
  const filteredBanks = banks.filter((b) => activeBankIds.includes(b.bankId));
  const allPeriods = periods.map((p) => p.period);
  const windowedPeriods = periodWindow > 0 ? allPeriods.slice(-periodWindow) : allPeriods;

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border-soft bg-surface p-1 text-xs">
            {[4, 8, 0].map((n) => (
              <button
                key={n}
                onClick={() => setPeriodWindow(n)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  periodWindow === n ? "bg-rbc-blue/40 text-white" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {n === 0 ? "All" : `${n}Q`}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">Pick a metric per chart to compare two trends side by side.</p>
        </div>

        <div className="flex items-center gap-2">
          <BankFilter />
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendChartPanel
          metricsMeta={metricsMeta}
          metric={metaA}
          onMetricChange={setFocusMetric}
          banks={filteredBanks}
          periods={windowedPeriods}
          badge="A"
        />
        <TrendChartPanel
          metricsMeta={metricsMeta}
          metric={metaB}
          onMetricChange={setSecondKey}
          banks={filteredBanks}
          periods={windowedPeriods}
          badge="B"
        />
      </div>
    </div>
  );
}
