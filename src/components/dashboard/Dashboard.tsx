"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useDashboardStore } from "@/lib/store";
import { Header } from "./Header";
import { NavTabs } from "./NavTabs";
import { OverviewTab } from "./OverviewTab";
import { TrendsTab } from "./TrendsTab";
import { PeerCompareTab } from "./PeerCompareTab";
import { FundingTab } from "./FundingTab";
import { VarianceTab } from "./VarianceTab";
import { SourcesTab } from "./SourcesTab";
import { AssistantTab } from "./AssistantTab";
import { ChatWidget } from "@/components/chat/ChatWidget";

export function Dashboard() {
  const activeTab = useDashboardStore((s) => s.activeTab);

  return (
    <>
      <Header />
      <NavTabs />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === "overview" && <OverviewTab />}
            {activeTab === "trends" && <TrendsTab />}
            {activeTab === "peers" && <PeerCompareTab />}
            {activeTab === "funding" && <FundingTab />}
            {activeTab === "variance" && <VarianceTab />}
            {activeTab === "sources" && <SourcesTab />}
            {activeTab === "assistant" && <AssistantTab />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="mx-auto w-full max-w-[1600px] px-6 pb-6 text-center text-[11px] text-text-muted">
        Illustrative internal prototype for RBC Corporate Treasury &middot; figures sourced from public quarterly disclosures of each institution &middot;
        not for external distribution.
      </footer>
      {activeTab !== "assistant" && <ChatWidget />}
    </>
  );
}
