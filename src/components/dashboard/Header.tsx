"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, LogOut, Presentation } from "lucide-react";
import { useDashboardData } from "@/lib/data-context";
import { exportRawCsv } from "@/lib/export";
import { Mark } from "@/components/ui/Mark";
import { useAuthStore } from "@/lib/auth-store";
import { ExportDeckPage } from "./ExportDeckPage";

export function Header() {
  const { banks, metricsMeta } = useDashboardData();
  const firstName = useAuthStore((s) => s.firstName);
  const logout = useAuthStore((s) => s.logout);
  const [deckOpen, setDeckOpen] = useState(false);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-30 border-b border-border-soft bg-base/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3.5">
          <Mark />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
                RBC <span className="text-gradient-blue">Treasury Intelligence</span>
              </h1>
              <span className="rounded-full border border-rbc-cyan/30 bg-rbc-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rbc-cyan">
                Beta
              </span>
            </div>
            <p className="text-xs text-text-muted">Corporate Treasury &middot; Peer Performance Benchmarking</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {firstName && (
            <span className="hidden text-xs text-text-secondary md:inline">
              Hi, <span className="font-semibold text-text-primary">{firstName}</span>
            </span>
          )}
          <button
            onClick={() => exportRawCsv(banks, metricsMeta)}
            className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_24px_-6px_rgba(0,182,241,0.6)] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <Download className="size-3.5" />
            Export Data
          </button>
          <button
            onClick={() => setDeckOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-rbc-cyan/40 bg-rbc-cyan/10 px-3.5 py-1.5 text-xs font-semibold text-rbc-cyan transition-colors hover:bg-rbc-cyan/20"
          >
            <Presentation className="size-3.5" />
            Export PowerPoint
          </button>
          <button
            onClick={logout}
            title="Sign out"
            className="flex items-center justify-center rounded-full border border-border-soft bg-surface/60 p-2 text-text-muted transition-colors hover:border-down/40 hover:text-down"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
      {deckOpen && <ExportDeckPage onClose={() => setDeckOpen(false)} />}
    </motion.header>
  );
}
