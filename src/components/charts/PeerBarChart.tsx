"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell, LabelList } from "recharts";
import type { LabelProps } from "recharts";
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

// Left edge of the plot area (YAxis width 48 + left margin 6). A value label must
// never be drawn past this, or it collides with the bank ticker labels.
const PLOT_LEFT = 54;


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

  // Average of the PEERS actually shown, excluding the home institution -- it is the
  // subject of the comparison, not a member of the group it is being compared against
  // (needs ≥2 peers to be meaningful).
  const peers = data.filter((d) => !d.home);
  const peerAvg = peers.length >= 2 ? peers.reduce((s, d) => s + d.value!, 0) / peers.length : null;
  const unitSuffix = metric.unit === "%" ? "%" : metric.unit === "x" ? "x" : "";

  // Recharts gives negative bars a negative width (x stays on the zero baseline), so a
  // fixed position="right" drops the label at the bar's far tip — on top of the bank
  // ticker labels for all-negative metrics like IRRBB ΔEVE. Place each label relative to
  // the bar's own value end instead: outside it when there's room in the plot, otherwise
  // inside the bar (white on the fill) so it never crowds the axis.
  const renderValueLabel = (props: LabelProps) => {
    const { x, y, width, height, value } = props;
    if (value == null || typeof value === "boolean" || Array.isArray(value) || x == null || y == null || width == null || height == null)
      return null;

    const barX = Number(x);
    const barW = Number(width);
    const text = `${Number(value).toFixed(metric.decimals)}${unitSuffix}`;
    const tipX = barX + barW; // the value end of the bar (left end when negative)
    const midY = Number(y) + Number(height) / 2;
    const negative = barW < 0;
    const textW = text.length * 6.4 + 8; // approximate rendered width
    const outsideX = negative ? tipX - 6 : tipX + 6;
    // Keep the label inside the bar when placing it outside would overlap the ticker
    // gutter, or when the bar is long enough to hold it comfortably.
    const inside = negative && (outsideX - textW < PLOT_LEFT || Math.abs(barW) > textW + 12);

    if (inside) {
      return (
        <text
          x={tipX + 8}
          y={midY}
          fill="#ffffff"
          fontSize={11}
          fontWeight={600}
          textAnchor="start"
          dominantBaseline="central"
        >
          {text}
        </text>
      );
    }
    return (
      <text
        x={outsideX}
        y={midY}
        fill="#eef4fc"
        fontSize={11}
        textAnchor={negative ? "end" : "start"}
        dominantBaseline="central"
      >
        {text}
      </text>
    );
  };

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
          <LabelList dataKey="value" content={renderValueLabel} />
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
