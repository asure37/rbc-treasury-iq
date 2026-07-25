"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import type { BankData, MetricMeta } from "@/types/metrics";

interface CapitalProfitabilityBubbleProps {
  banks: BankData[];
  period: string;
  xMetric: MetricMeta;
  yMetric: MetricMeta;
  sizeMetric: MetricMeta;
  height?: number;
}

interface BubbleDatum {
  bankId: string;
  name: string;
  bankName: string;
  x: number;
  y: number;
  z: number;
  color: string;
  home?: boolean;
}

export function CapitalProfitabilityBubble({ banks, period, xMetric, yMetric, sizeMetric, height = 340 }: CapitalProfitabilityBubbleProps) {
  const points = banks
    .map((b): BubbleDatum | null => {
      const q = b.quarters.find((q) => q.period === period);
      const x = q?.metrics[xMetric.key];
      const y = q?.metrics[yMetric.key];
      const z = q?.metrics[sizeMetric.key];
      if (x == null || y == null || z == null) return null;
      return { bankId: b.bankId, name: b.ticker, bankName: b.bankName, x, y, z, color: b.colorHex, home: b.isHomeInstitution };
    })
    .filter((d): d is BubbleDatum => d !== null);

  if (points.length === 0) {
    return <div className="flex h-[340px] items-center justify-center text-sm text-text-muted">No data for {period}</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 20, right: 30, bottom: 10, left: 0 }}>
        <CartesianGrid stroke="rgba(140,175,220,0.08)" />
        <XAxis
          type="number"
          dataKey="x"
          name={xMetric.shortLabel}
          unit="%"
          stroke="#6b7f9e"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          domain={["dataMin - 0.5", "dataMax + 0.5"]}
          label={{ value: xMetric.shortLabel, position: "insideBottom", offset: -4, fill: "#a8bbd6", fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yMetric.shortLabel}
          unit="%"
          stroke="#6b7f9e"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          domain={["dataMin - 1", "dataMax + 1"]}
          label={{ value: yMetric.shortLabel, angle: -90, position: "insideLeft", fill: "#a8bbd6", fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="z" range={[600, 2600]} name={sizeMetric.shortLabel} />
        {xMetric.regulatoryMinimum != null && (
          <ReferenceLine x={xMetric.regulatoryMinimum} stroke="#fb7185" strokeDasharray="4 4" />
        )}
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: "rgba(140,175,220,0.3)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as BubbleDatum;
            return (
              <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-text-secondary">
                  <span className="inline-block size-2 rounded-full" style={{ background: d.color }} />
                  {d.bankName}
                </div>
                <div className="space-y-0.5 tabular-nums text-text-primary">
                  <div>
                    {xMetric.shortLabel}: <span className="font-semibold">{d.x.toFixed(xMetric.decimals)}%</span>
                  </div>
                  <div>
                    {yMetric.shortLabel}: <span className="font-semibold">{d.y.toFixed(yMetric.decimals)}%</span>
                  </div>
                  <div>
                    {sizeMetric.shortLabel}: <span className="font-semibold">${d.z.toLocaleString()}B</span>
                  </div>
                </div>
              </div>
            );
          }}
        />
        {points.map((d) => (
          <Scatter
            key={d.bankId}
            name={d.name}
            data={[d]}
            fill={d.color}
            fillOpacity={d.home ? 0.9 : 0.55}
            stroke={d.home ? "#fff" : d.color}
            strokeWidth={d.home ? 1.5 : 0}
            isAnimationActive
            animationDuration={700}
          >
            <LabelList dataKey="name" position="top" fill="#eef4fc" fontSize={11} fontWeight={600} />
          </Scatter>
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
