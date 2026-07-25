"use client";

import { motion } from "framer-motion";
import { LayoutGrid, TrendingUp, Users, PiggyBank, AlertTriangle, FileSearch, Sparkles } from "lucide-react";
import { useDashboardStore, type TabId } from "@/lib/store";
import { cn } from "@/lib/cn";

const TABS: { id: TabId; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "trends", label: "Historical Trends", icon: TrendingUp },
  { id: "peers", label: "Peer Comparison", icon: Users },
  { id: "funding", label: "Funding & IRRBB", icon: PiggyBank },
  { id: "variance", label: "Variance & Outliers", icon: AlertTriangle },
  { id: "sources", label: "Data Lineage", icon: FileSearch },
  { id: "assistant", label: "Treasury IQ Assistant", icon: Sparkles },
];

export function NavTabs() {
  const activeTab = useDashboardStore((s) => s.activeTab);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);

  return (
    <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-6 pt-4">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-t-xl px-5 py-3.5 text-base font-medium transition-colors",
              isActive ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
            {isActive && (
              <motion.div
                layoutId="nav-underline"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-rbc-cyan to-rbc-blue"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
