"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import type { MetricMeta } from "@/types/metrics";
import { cn } from "@/lib/cn";

interface KpiCardProps {
  meta: MetricMeta;
  value: number | null;
  qoqDelta: number | null;
  peerAvg: number | null;
  history: { value: number | null }[];
  delay?: number;
  onClick?: () => void;
  active?: boolean;
  /** This issuer does not publish the metric; the value was computed from figures it does. */
  derived?: boolean;
}

export function KpiCard({ meta, value, qoqDelta, peerAvg, history, delay, onClick, active, derived }: KpiCardProps) {
  const vsRegMin = meta.regulatoryMinimum != null && value != null ? value - meta.regulatoryMinimum : null;
  const belowMin = vsRegMin != null && vsRegMin < 0;
  const vsPeer = peerAvg != null && value != null ? value - peerAvg : null;

  return (
    <GlassCard
      delay={delay}
      onClick={onClick}
      className={cn(
        "cursor-pointer p-5 transition-all hover:border-rbc-cyan/50 hover:shadow-[0_0_40px_-8px_rgba(0,182,241,0.35)]",
        active && "border-rbc-cyan/60 shadow-[0_0_40px_-8px_rgba(0,182,241,0.45)]",
        belowMin && "border-down/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {meta.shortLabel}
            {derived && (
              <span
                className="ml-0.5 cursor-help text-rbc-cyan"
                title={`Computed, not disclosed. ${meta.label} is not published by this bank; the value is derived from figures it does disclose. See the Data Lineage tab for the formula and operands.`}
              >
                *
              </span>
            )}
          </p>
          <div className="mt-1.5 flex items-baseline gap-1 font-display">
            {value != null ? (
              <AnimatedNumber value={value} decimals={meta.decimals} suffix={meta.unit === "%" ? "%" : ""} prefix={meta.unit === "$B" || meta.unit === "$M" || meta.unit === "$" ? "$" : ""} className="text-2xl font-semibold tabular-nums text-text-primary" />
            ) : (
              <span className="text-2xl font-semibold text-text-muted">—</span>
            )}
            {meta.unit !== "%" && value != null && <span className="text-sm text-text-muted">{meta.unit.replace("$", "")}</span>}
          </div>
        </div>
        <DeltaBadge delta={qoqDelta} higherIsBetter={meta.higherIsBetter} decimals={meta.decimals} unit={meta.unit === "%" ? "pp" : ""} />
      </div>

      <div className="mt-3">
        <Sparkline data={history} color="#00b6f1" />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
        <span>
          vs peer avg{" "}
          {vsPeer != null ? (
            <span className={vsPeer >= 0 ? "text-up" : "text-down"}>
              {vsPeer >= 0 ? "+" : ""}
              {vsPeer.toFixed(meta.decimals)}
            </span>
          ) : (
            "—"
          )}
        </span>
        {meta.regulatoryMinimum != null && (
          <span className={belowMin ? "font-semibold text-down" : ""}>min {meta.regulatoryMinimum}%</span>
        )}
      </div>
    </GlassCard>
  );
}
