"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { BankData, MetricMeta } from "@/types/metrics";

interface DepositCompositionChartProps {
  banks: BankData[];
  period: string;
  metricA: MetricMeta;
  metricB: MetricMeta;
  colorA?: string;
  colorB?: string;
  height?: number;
}

// 100%-stacked horizontal bar: one bar per bank, two segments summing to
// (approximately) the disclosed total — e.g. retail vs. wholesale deposits.
export function DepositCompositionChart({
  banks,
  period,
  metricA,
  metricB,
  colorA = "#5ce1ff",
  colorB = "#0051a5",
  height = 280,
}: DepositCompositionChartProps) {
  const data = banks
    .map((b) => {
      const q = b.quarters.find((q) => q.period === period);
      const a = q?.metrics[metricA.key];
      const bVal = q?.metrics[metricB.key];
      if (a == null && bVal == null) return null;
      return {
        bankId: b.bankId,
        name: b.ticker,
        bankName: b.bankName,
        home: b.isHomeInstitution,
        [metricA.key]: a ?? 0,
        [metricB.key]: bVal ?? 0,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  if (data.length === 0) {
    return <div className="flex h-[160px] items-center justify-center text-sm text-text-muted">No data for {period}</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 6, right: 30, bottom: 6, left: 6 }}>
        <CartesianGrid stroke="rgba(140,175,220,0.08)" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} unit="%" stroke="#6b7f9e" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" stroke="#a8bbd6" fontSize={12} fontWeight={600} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          cursor={{ fill: "rgba(140,175,220,0.06)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as Record<string, unknown> & { bankName: string };
            return (
              <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
                <div className="mb-1 font-medium text-text-secondary">{d.bankName}</div>
                <div className="flex items-center gap-1.5 tabular-nums text-text-primary">
                  <span className="inline-block size-2 rounded-full" style={{ background: colorA }} />
                  {metricA.shortLabel}: <span className="font-semibold">{Number(d[metricA.key]).toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-1.5 tabular-nums text-text-primary">
                  <span className="inline-block size-2 rounded-full" style={{ background: colorB }} />
                  {metricB.shortLabel}: <span className="font-semibold">{Number(d[metricB.key]).toFixed(1)}%</span>
                </div>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#a8bbd6" }} />
        <Bar dataKey={metricA.key} stackId="composition" name={metricA.shortLabel} fill={colorA} radius={[6, 0, 0, 6]} isAnimationActive animationDuration={700} />
        <Bar dataKey={metricB.key} stackId="composition" name={metricB.shortLabel} fill={colorB} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}
