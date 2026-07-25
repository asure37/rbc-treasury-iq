"use client";

import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: { value: number | null }[];
  color?: string;
  colorTo?: string;
  height?: number;
}

export function Sparkline({ data, color = "#0051a5", colorTo = "#5ce1ff", height = 44 }: SparklineProps) {
  const id = `spark-${color.replace("#", "")}-${colorTo.replace("#", "")}`;
  const cleaned = data.map((d, i) => ({ i, value: d.value }));
  const values = cleaned.map((d) => d.value).filter((v): v is number => v != null);
  if (values.length < 2) return <div style={{ height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.25 || 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={cleaned} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorTo} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={colorTo} />
          </linearGradient>
        </defs>
        <YAxis domain={[min - pad, max + pad]} hide />
        <Area
          type="linear"
          dataKey="value"
          stroke={`url(#${id}-stroke)`}
          strokeWidth={2.25}
          fill={`url(#${id}-fill)`}
          isAnimationActive
          animationDuration={900}
          connectNulls
          style={{ filter: "drop-shadow(0 0 3px rgba(92,225,255,0.5))" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
