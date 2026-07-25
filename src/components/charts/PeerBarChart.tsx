"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell, LabelList } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import type { BankData, MetricMeta } from "@/types/metrics";

interface PeerBarChartProps {
  banks: BankData[];
  period: string;
  metric: MetricMeta;
  height?: number;
}

// Neutral, desaturated tone for the "average of displayed banks" reference line —
// deliberately distinct from every bank colour and the reg-min reference line.
const PEER_AVG_COLOR = "#c9d4e6";

export function PeerBarChart({ banks, period, metric, height = 320 }: PeerBarChartProps) {
  const data = banks
    .map((b) => {
      const q = b.quarters.find((q) => q.period === period);
      return {
        bankId: b.bankId,
        name: b.ticker,
        value: q?.metrics[metric.key] ?? null,
        color: b.colorHex,
        home: b.isHomeInstitution,
      };
    })
    .filter((d) => d.value != null)
    .sort((a, b) => (metric.higherIsBetter === false ? a.value! - b.value! : b.value! - a.value!));

  // Average of the banks actually shown (needs ≥2 to be meaningful).
  const peerAvg = data.length >= 2 ? data.reduce((s, d) => s + d.value!, 0) / data.length : null;
  const unitSuffix = metric.unit === "%" ? "%" : "";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 18, right: 40, bottom: 6, left: 6 }}>
        <CartesianGrid stroke="rgba(140,175,220,0.08)" horizontal={false} />
        <XAxis type="number" stroke="#6b7f9e" fontSize={11} tickLine={false} axisLine={false} unit={metric.unit === "%" ? "%" : ""} />
        <YAxis type="category" dataKey="name" stroke="#a8bbd6" fontSize={12} fontWeight={600} tickLine={false} axisLine={false} width={48} />
        <Tooltip cursor={{ fill: "rgba(140,175,220,0.06)" }} content={<ChartTooltip unit={metric.unit === "%" ? "%" : ""} decimals={metric.decimals} />} />
        {metric.regulatoryMinimum != null && (
          <ReferenceLine x={metric.regulatoryMinimum} stroke="#fb7185" strokeDasharray="4 4" />
        )}
        <Bar dataKey="value" name={metric.shortLabel} radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700}>
          {data.map((d) => (
            <Cell key={d.bankId} fill={d.color} fillOpacity={d.home ? 1 : 0.65} stroke={d.home ? "#fff" : "none"} strokeOpacity={0.2} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => (v == null ? "" : `${Number(v).toFixed(metric.decimals)}${metric.unit === "%" ? "%" : ""}`)}
            fill="#eef4fc"
            fontSize={11}
          />
        </Bar>
        {peerAvg != null && (
          <ReferenceLine
            x={peerAvg}
            stroke={PEER_AVG_COLOR}
            strokeDasharray="5 4"
            strokeOpacity={0.9}
            label={{
              value: `Peer avg ${peerAvg.toFixed(metric.decimals)}${unitSuffix}`,
              position: "top",
              fill: PEER_AVG_COLOR,
              fontSize: 10,
            }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
