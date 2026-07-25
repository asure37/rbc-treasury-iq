"use client";

import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function BankFilter() {
  const { banks } = useDashboardData();
  const selected = useDashboardStore((s) => s.selectedBankIds);
  const toggleBank = useDashboardStore((s) => s.toggleBank);
  const allIds = banks.map((b) => b.bankId);
  const active = selected.length ? selected : allIds;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {banks.map((bank) => {
        const isOn = active.includes(bank.bankId);
        return (
          <button
            key={bank.bankId}
            onClick={() => toggleBank(bank.bankId, allIds)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
              isOn
                ? "border-transparent text-white shadow-[0_0_16px_-4px_rgba(0,182,241,0.5)]"
                : "border-border-soft bg-surface/40 text-text-muted hover:text-text-secondary"
            )}
            style={isOn ? { background: `${bank.colorHex}25`, borderColor: `${bank.colorHex}80`, color: "#fff" } : undefined}
          >
            <span className="inline-block size-2 rounded-full" style={{ background: bank.colorHex }} />
            {bank.ticker}
            {bank.isHomeInstitution && <span className="text-rbc-cyan">★</span>}
          </button>
        );
      })}
    </div>
  );
}
