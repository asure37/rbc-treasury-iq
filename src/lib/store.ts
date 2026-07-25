import { create } from "zustand";
import type { MetricKey } from "@/types/metrics";

export type TabId = "overview" | "trends" | "peers" | "funding" | "variance" | "sources" | "assistant";

interface DashboardState {
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;

  selectedBankIds: string[];
  toggleBank: (id: string, allIds: string[]) => void;
  setSelectedBanks: (ids: string[]) => void;

  focusMetric: MetricKey;
  setFocusMetric: (m: MetricKey) => void;

  periodWindow: number; // number of trailing quarters to display; 0 = all
  setPeriodWindow: (n: number) => void;

  drillDownTarget: { bankId: string; period: string } | null;
  openDrillDown: (bankId: string, period: string) => void;
  closeDrillDown: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  activeTab: "overview",
  setActiveTab: (t) => set({ activeTab: t }),

  selectedBankIds: [],
  toggleBank: (id, allIds) => {
    const current = get().selectedBankIds.length ? get().selectedBankIds : allIds;
    const has = current.includes(id);
    const next = has ? current.filter((b) => b !== id) : [...current, id];
    set({ selectedBankIds: next.length ? next : allIds });
  },
  setSelectedBanks: (ids) => set({ selectedBankIds: ids }),

  focusMetric: "cet1Ratio",
  setFocusMetric: (m) => set({ focusMetric: m }),

  periodWindow: 8,
  setPeriodWindow: (n) => set({ periodWindow: n }),

  drillDownTarget: null,
  openDrillDown: (bankId, period) => set({ drillDownTarget: { bankId, period } }),
  closeDrillDown: () => set({ drillDownTarget: null }),
}));
