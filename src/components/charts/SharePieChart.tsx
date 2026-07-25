"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { BankData, MetricMeta } from "@/types/metrics";

interface SharePieChartProps {
  banks: BankData[];
  period: string;
  metric: MetricMeta;
  height?: number;
}

interface SliceDatum {
  bankId: string;
  name: string;
  bankName: string;
  value: number;
  color: string;
  home?: boolean;
}

export function SharePieChart({ banks, period, metric, height = 240 }: SharePieChartProps) {
  const raw = banks
    .map((b): SliceDatum | null => {
      const q = b.quarters.find((q) => q.period === period);
      const value = q?.metrics[metric.key];
      return value != null ? { bankId: b.bankId, name: b.ticker, bankName: b.bankName, value, color: b.colorHex, home: b.isHomeInstitution } : null;
    })
    .filter((d): d is SliceDatum => d !== null)
    .sort((a, b) => b.value - a.value);

  const total = raw.reduce((s, d) => s + d.value, 0);

  if (raw.length === 0) {
    return <div className="flex h-[300px] items-center justify-center text-sm text-text-muted">No data for {period}</div>;
  }

  const leader = raw[0];
  const leaderShare = (leader.value / total) * 100;

  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={raw}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={3}
              cornerRadius={8}
              isAnimationActive
              animationDuration={700}
              className="chart-ring-glow"
              label={({ value }) => `${((value / total) * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {raw.map((d) => (
                <Cell
                  key={d.bankId}
                  fill={d.color}
                  fillOpacity={d.home ? 1 : 0.78}
                  stroke={d.home ? "#fff" : "none"}
                  strokeOpacity={0.25}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as SliceDatum;
                return (
                  <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 flex items-center gap-1.5 font-medium text-text-secondary">
                      <span className="inline-block size-2 rounded-full" style={{ background: d.color }} />
                      {d.bankName}
                    </div>
                    <div className="tabular-nums text-text-primary">
                      {metric.unit === "$B" ? `$${d.value.toLocaleString()}B` : metric.unit === "$M" ? `$${d.value.toLocaleString()}M` : `${d.value.toFixed(metric.decimals)}%`}
                      <span className="ml-1.5 text-text-muted">({((d.value / total) * 100).toFixed(1)}% share)</span>
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Largest Share</p>
          <p className="font-display text-2xl font-bold tabular-nums text-text-primary">
            {leaderShare.toFixed(0)}
            <span className="text-base text-text-muted">%</span>
          </p>
          <p className="text-xs font-semibold" style={{ color: leader.color }}>
            {leader.name}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {raw.map((d) => (
          <span key={d.bankId} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="inline-block size-2 rounded-full" style={{ background: d.color }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}
