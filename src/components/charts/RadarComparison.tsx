"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { BankData, MetricKey, MetricMeta } from "@/types/metrics";

interface RadarComparisonProps {
  banks: BankData[];
  period: string;
  metrics: MetricMeta[];
  height?: number;
}

// Normalizes each metric axis to 0-100 across the given banks so ratios with
// very different natural ranges (e.g. LCR ~120 vs NIM ~1.7) share one radar.
export function RadarComparison({ banks, period, metrics, height = 360 }: RadarComparisonProps) {
  const raw: Record<MetricKey, Record<string, number>> = {} as never;
  for (const m of metrics) {
    raw[m.key] = {};
    for (const b of banks) {
      const q = b.quarters.find((q) => q.period === period);
      const v = q?.metrics[m.key];
      if (v != null) raw[m.key][b.bankId] = v;
    }
  }

  const data = metrics.map((m) => {
    const values = Object.values(raw[m.key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const row: Record<string, string | number> = { metric: m.shortLabel };
    for (const b of banks) {
      const v = raw[m.key][b.bankId];
      if (v == null) continue;
      let score: number;
      if (max === min) score = 100;
      else score = m.higherIsBetter === false ? ((max - v) / (max - min)) * 100 : ((v - min) / (max - min)) * 100;
      row[b.bankId] = Math.round(score);
      row[`${b.bankId}__raw`] = v;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="rgba(140,175,220,0.15)" />
        <PolarAngleAxis dataKey="metric" tick={{ fill: "#a8bbd6", fontSize: 11 }} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
                <div className="mb-1 font-medium text-text-secondary">{label}</div>
                {payload.map((p) => {
                  const bankId = p.dataKey as string;
                  const raw = (p.payload as Record<string, number>)[`${bankId}__raw`];
                  const bank = banks.find((b) => b.bankId === bankId);
                  return (
                    <div key={bankId} className="flex items-center gap-2">
                      <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
                      <span className="text-text-secondary">{bank?.ticker}:</span>
                      <span className="font-semibold text-text-primary">{raw?.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#a8bbd6" }} formatter={(v) => banks.find((b) => b.bankId === v)?.ticker ?? v} />
        {banks.map((bank) => (
          <Radar
            key={bank.bankId}
            name={bank.bankId}
            dataKey={bank.bankId}
            stroke={bank.colorHex}
            fill={bank.colorHex}
            fillOpacity={bank.isHomeInstitution ? 0.28 : 0.06}
            strokeWidth={bank.isHomeInstitution ? 3 : 1.5}
            isAnimationActive
            animationDuration={700}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
