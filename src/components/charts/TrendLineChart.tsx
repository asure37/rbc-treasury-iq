"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import type { BankData, MetricMeta } from "@/types/metrics";

interface TrendLineChartProps {
  banks: BankData[];
  periods: string[];
  metric: MetricMeta;
  height?: number;
}

// Neutral, desaturated tone for the "average of displayed banks" reference line —
// deliberately distinct from every bank colour and the reg-min / OSFI reference lines.
const PEER_AVG_COLOR = "#c9d4e6";

// Clean, properly-cased labels for the tooltip (bank ids are stored lower-case).
const DISPLAY_NAME: Record<string, string> = {
  rbc: "RBC",
  td: "TD",
  scotia: "Scotia",
  bmo: "BMO",
  cibc: "CIBC",
  national: "National",
};
const displayName = (bankId: string) => DISPLAY_NAME[bankId] ?? bankId;

export function TrendLineChart({ banks, periods, metric, height = 380 }: TrendLineChartProps) {
  const homeId = banks.find((b) => b.isHomeInstitution)?.bankId;

  // "Peer average" means the PEERS. The home institution is the subject being benchmarked,
  // so folding it into its own comparator drags the line toward RBC and understates every
  // gap the chart exists to show. Only worth drawing when at least two peers remain.
  const showPeerAvg = banks.filter((b) => b.bankId !== homeId).length >= 2;

  const data = periods.map((period) => {
    const row: Record<string, string | number | null> = { period };
    const peerValues: number[] = [];
    for (const bank of banks) {
      const q = bank.quarters.find((q) => q.period === period);
      const value = q?.metrics[metric.key] ?? null;
      row[bank.bankId] = value;
      if (value != null && bank.bankId !== homeId) peerValues.push(value);
    }
    // Average across the PEERS that actually reported this period (needs ≥2 to be meaningful).
    row.__peerAvg =
      showPeerAvg && peerValues.length >= 2 ? peerValues.reduce((s, v) => s + v, 0) / peerValues.length : null;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
        <defs>
          {banks
            .filter((b) => b.isHomeInstitution)
            .map((bank) => (
              <linearGradient key={bank.bankId} id={`line-grad-${bank.bankId}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={bank.colorHex} />
                <stop offset="100%" stopColor="#5ce1ff" />
              </linearGradient>
            ))}
        </defs>
        <CartesianGrid stroke="rgba(140,175,220,0.08)" vertical={false} />
        <XAxis dataKey="period" stroke="#6b7f9e" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#6b7f9e"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          unit={metric.unit === "%" ? "%" : ""}
          width={44}
          domain={["auto", "auto"]}
        />
        <Tooltip
          cursor={{ stroke: "#00b6f1", strokeWidth: 1, strokeDasharray: "4 4" }}
          content={<ChartTooltip unit={metric.unit === "%" ? "%" : ""} decimals={metric.decimals} />}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#a8bbd6" }}
          formatter={(value) => banks.find((b) => displayName(b.bankId) === value)?.ticker ?? value}
        />
        {metric.regulatoryMinimum != null && (
          <ReferenceLine
            y={metric.regulatoryMinimum}
            stroke="#fb7185"
            strokeDasharray="4 4"
            label={{ value: `Reg. min ${metric.regulatoryMinimum}%`, position: "insideBottomLeft", fill: "#fb7185", fontSize: 10 }}
          />
        )}
        {metric.supervisoryTarget != null && (
          <ReferenceLine
            y={metric.supervisoryTarget}
            stroke="#fbbf24"
            strokeDasharray="4 4"
            label={{ value: `OSFI target ${metric.supervisoryTarget}%`, position: "insideTopLeft", fill: "#fbbf24", fontSize: 10 }}
          />
        )}
        {banks.map((bank) => {
          const isHome = bank.bankId === homeId;
          return (
            <Line
              key={bank.bankId}
              type="linear"
              dataKey={bank.bankId}
              name={displayName(bank.bankId)}
              stroke={isHome ? `url(#line-grad-${bank.bankId})` : bank.colorHex}
              strokeWidth={isHome ? 3.5 : 2}
              strokeOpacity={isHome ? 1 : 0.65}
              className={isHome ? "chart-line-glow" : undefined}
              dot={{ r: 3, strokeWidth: 0, fill: bank.colorHex }}
              activeDot={isHome ? { r: 6, stroke: "#fff", strokeWidth: 2, fill: bank.colorHex } : { r: 4 }}
              connectNulls
              isAnimationActive
              animationDuration={700}
            />
          );
        })}
        {showPeerAvg && (
          <Line
            type="monotone"
            dataKey="__peerAvg"
            name="Peer avg"
            stroke={PEER_AVG_COLOR}
            strokeWidth={2}
            strokeDasharray="6 5"
            strokeOpacity={0.9}
            dot={false}
            activeDot={{ r: 4, stroke: "#0b1220", strokeWidth: 1.5, fill: PEER_AVG_COLOR }}
            connectNulls
            isAnimationActive
            animationDuration={700}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
