"use client";

import type { TooltipContentProps } from "recharts";

interface Props extends Partial<TooltipContentProps<number, string>> {
  unit?: string;
  decimals?: number;
}

export function ChartTooltip({ active, payload, label, unit = "%", decimals = 1 }: Props) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-text-secondary">{label}</div>
      <div className="space-y-1">
        {payload
          .slice()
          .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
          .map((p) => (
            <div key={p.dataKey as string} className="flex items-center gap-2 tabular-nums">
              <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
              <span className="text-text-secondary">{p.name}:</span>
              <span className="font-semibold text-text-primary">
                {p.value == null ? "—" : `${(p.value as number).toFixed(decimals)}${unit}`}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
