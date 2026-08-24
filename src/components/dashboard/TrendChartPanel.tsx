"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Image as ImageIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { exportChartAsPng, exportMetricCsv } from "@/lib/export";
import type { BankData, MetricKey, MetricMeta } from "@/types/metrics";

interface TrendChartPanelProps {
  metricsMeta: MetricMeta[];
  metric: MetricMeta;
  onMetricChange: (key: MetricKey) => void;
  banks: BankData[]; // already filtered to the selected banks
  periods: string[]; // already windowed period labels
  badge?: string; // small label to distinguish the panels, e.g. "A" / "B"
}

// One self-contained trend chart: its own metric selector, PNG/CSV export, and the
// shared TrendLineChart. Two of these sit side-by-side in the Historical Trends tab so
// the user can compare two different metrics over the same banks and time window.
export function TrendChartPanel({ metricsMeta, metric, onMetricChange, banks, periods, badge }: TrendChartPanelProps) {
  // Alphabetical by the label the reader actually sees. Sort a COPY: metricsMeta comes
  // from shared context, and sorting it in place would reorder the heat map and the
  // lineage tab too.
  const metricOptions = useMemo(
    () => [...metricsMeta].sort((a, b) => a.label.localeCompare(b.label)),
    [metricsMeta]
  );
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handlePng = async () => {
    if (!chartRef.current) return;
    setExporting(true);
    try {
      await exportChartAsPng(chartRef.current, `${metric.shortLabel}-trend-${Date.now()}.png`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <GlassCard className="p-5" ref={chartRef}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {badge && (
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-rbc-blue/30 text-[10px] font-bold text-rbc-cyan">
              {badge}
            </span>
          )}
          <select
            value={metric.key}
            onChange={(e) => onMetricChange(e.target.value as MetricKey)}
            aria-label="Select metric"
            className="max-w-[16rem] truncate rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm font-medium text-text-primary outline-none focus:border-rbc-cyan/60"
          >
            {metricOptions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handlePng}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-50"
          >
            <ImageIcon className="size-3.5" /> PNG
          </button>
          <button
            onClick={() => exportMetricCsv(banks, metric.key, periods)}
            className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
          >
            <Download className="size-3.5" /> CSV
          </button>
        </div>
      </div>
      <p className="mb-2 min-h-[2rem] text-xs text-text-muted">{metric.description}</p>
      <TrendLineChart banks={banks} periods={periods} metric={metric} height={340} />
    </GlassCard>
  );
}
