"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useAuthStore } from "@/lib/auth-store";
import { useHasHydrated } from "@/lib/use-has-hydrated";
import { DataProvider, type DashboardData } from "@/lib/data-context";
import { WelcomeScreen } from "./WelcomeScreen";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { Mark } from "@/components/ui/Mark";

export function AppGate({ data }: { data: DashboardData }) {
  const hydrated = useHasHydrated();
  const stage = useAuthStore((s) => s.stage);
  const advanceToDashboard = useAuthStore((s) => s.advanceToDashboard);

  if (!hydrated) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center">
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
          <Mark size={40} />
        </motion.div>
      </div>
    );
  }

  return (
    <DataProvider value={data}>
      <AnimatePresence mode="wait">
        {stage !== "dashboard" && <WelcomeScreen key="welcome" onContinue={advanceToDashboard} />}
        {stage === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-dvh w-full flex-col"
          >
            <Dashboard />
          </motion.div>
        )}
      </AnimatePresence>
    </DataProvider>
  );
}
