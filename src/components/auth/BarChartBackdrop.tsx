"use client";

import { motion } from "framer-motion";
import { useDashboardData } from "@/lib/data-context";
import { cn } from "@/lib/cn";

export function BarChartBackdrop({ align }: { align: "left" | "right" }) {
  const { banks } = useDashboardData();

  const bars = banks
    .map((b) => {
      const latest = [...b.quarters].reverse().find((q) => q.metrics.totalAssetsBillions != null);
      return latest ? { bankId: b.bankId, color: b.colorHex, value: latest.metrics.totalAssetsBillions! } : null;
    })
    .filter((d): d is { bankId: string; color: string; value: number } => d !== null)
    .sort((a, b) => a.value - b.value);

  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.value));
  const maxBarPx = 140;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-[24%] z-0 hidden h-[140px] items-end gap-2 opacity-[0.28] lg:flex",
        align === "left" ? "left-6" : "right-6"
      )}
    >
      {bars.map((b, i) => (
        <motion.div
          key={b.bankId}
          initial={{ height: 0 }}
          animate={{ height: Math.max((b.value / max) * maxBarPx, 4) }}
          transition={{ duration: 1, delay: 0.5 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="w-3 rounded-t-sm"
          style={{ background: b.color }}
        />
      ))}
    </div>
  );
}
