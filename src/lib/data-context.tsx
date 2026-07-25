"use client";

import { createContext, useContext } from "react";
import type { BankData, MetricMeta } from "@/types/metrics";

export interface DashboardData {
  banks: BankData[];
  metricsMeta: MetricMeta[];
  periods: { period: string; periodEnd: string }[];
  generatedAt: string;
  sourceMethodology: string;
}

const DataContext = createContext<DashboardData | null>(null);

export function DataProvider({ value, children }: { value: DashboardData; children: React.ReactNode }) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDashboardData(): DashboardData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDashboardData must be used within DataProvider");
  return ctx;
}
