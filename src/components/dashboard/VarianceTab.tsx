"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp, ChevronRight } from "lucide-react";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { GlassCard } from "@/components/ui/GlassCard";
import { detectTimeSeriesAnomalies, detectPeerOutliers } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import type { MetricKey } from "@/types/metrics";

export function VarianceTab() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const [severityFilter, setSeverityFilter] = useState<"all" | "alert" | "watch">("all");

  const latestPeriod = periods[periods.length - 1]?.period;
  // The peer baseline excludes the home institution -- see detectPeerOutliers.
  const homeBankId = banks.find((b) => b.isHomeInstitution)?.bankId;

  const timeSeriesAnomalies = useMemo(() => {
    return metricsMeta.flatMap((m) => detectTimeSeriesAnomalies(banks, m.key));
  }, [banks, metricsMeta]);

  const peerOutliers = useMemo(() => {
    if (!latestPeriod) return [];
    return metricsMeta.flatMap((m) =>
      detectPeerOutliers(banks, m.key, latestPeriod, {
        regulatoryMinimum: m.regulatoryMinimum,
        baselineExcludeBankId: homeBankId,
      })
    );
  }, [banks, metricsMeta, latestPeriod, homeBankId]);

  const filteredTs = timeSeriesAnomalies.filter((a) => severityFilter === "all" || a.severity === severityFilter);

  const jump = (key: MetricKey) => {
    setFocusMetric(key);
    setActiveTab("trends");
  };

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5" glow>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-warn/10">
            <AlertTriangle className="size-5 text-warn" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-text-primary">Variance & Outlier Detection</h2>
            <p className="text-xs text-text-muted">
              Statistical spike detection (z-score vs. own history) and cross-bank peer deviation, computed live from the ingested dataset.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border-soft bg-surface p-1 text-xs">
          {(["all", "alert", "watch"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                severityFilter === s ? "bg-rbc-blue/40 text-white" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h3 className="mb-1 font-display text-sm font-semibold text-text-primary">Time-Series Spikes</h3>
          <p className="mb-3 text-xs text-text-muted">Quarter-over-quarter moves that are statistically unusual for that bank-metric&apos;s own history.</p>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {filteredTs.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No anomalies flagged.</p>}
            {filteredTs.map((a, i) => {
              const meta = metricsMeta.find((m) => m.key === a.metric)!;
              return (
                <button
                  key={`${a.bankId}-${a.metric}-${a.period}-${i}`}
                  onClick={() => jump(a.metric)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface/50 p-3 text-left transition-colors hover:border-rbc-cyan/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        a.severity === "alert" ? "bg-down/15 text-down" : "bg-warn/15 text-warn"
                      )}
                    >
                      {a.delta > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {a.bankName} &middot; {meta.shortLabel}
                      </p>
                      <p className="text-xs text-text-muted">
                        {a.previousPeriod} &rarr; {a.period}: {a.previousValue.toFixed(meta.decimals)} &rarr;{" "}
                        {a.value.toFixed(meta.decimals)}
                        {meta.unit === "%" ? "pp" : meta.unit} move, z={a.zScore.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-text-muted" />
                </button>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-1 font-display text-sm font-semibold text-text-primary">Peer Deviation &mdash; {latestPeriod}</h3>
          <p className="mb-3 text-xs text-text-muted">Banks whose latest value deviates sharply from the peer group, or falls below the regulatory minimum.</p>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {peerOutliers.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No peer outliers flagged.</p>}
            {peerOutliers.map((o, i) => {
              const meta = metricsMeta.find((m) => m.key === o.metric)!;
              return (
                <button
                  key={`${o.bankId}-${o.metric}-${i}`}
                  onClick={() => jump(o.metric)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-surface/50 p-3 text-left transition-colors hover:border-rbc-cyan/40"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {o.bankName} &middot; {meta.shortLabel}
                      {o.belowRegMinimum && <span className="ml-1.5 rounded-full bg-down/15 px-1.5 py-0.5 text-[10px] font-semibold text-down">BELOW MIN</span>}
                    </p>
                    <p className="text-xs text-text-muted">
                      {o.value.toFixed(meta.decimals)}
                      {meta.unit === "%" ? "%" : ""} vs peer avg {o.peerMean.toFixed(meta.decimals)} (z={o.zScore.toFixed(2)})
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-text-muted" />
                </button>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
