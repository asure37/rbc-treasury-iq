"use client";

import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

interface DeltaBadgeProps {
  delta: number | null;
  unit?: string;
  higherIsBetter?: boolean | null;
  decimals?: number;
  className?: string;
}

export function DeltaBadge({ delta, unit = "%", higherIsBetter = true, decimals = 1, className }: DeltaBadgeProps) {
  if (delta == null || Number.isNaN(delta)) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-neutral bg-white/5", className)}>
        <Minus className="size-3" /> n/a
      </span>
    );
  }

  const isUp = delta > 0;
  const isFlat = Math.abs(delta) < 10 ** -decimals / 2;
  const good = higherIsBetter == null ? null : isUp === higherIsBetter;

  const colorClass = isFlat
    ? "text-neutral bg-white/5"
    : good === null
      ? "text-rbc-cyan bg-rbc-cyan/10"
      : good
        ? "text-up bg-up/10"
        : "text-down bg-down/10";

  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", colorClass, className)}>
      <Icon className="size-3" />
      {isUp && !isFlat ? "+" : ""}
      {delta.toFixed(decimals)}
      {unit}
    </span>
  );
}
