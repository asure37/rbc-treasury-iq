"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, ShieldCheck, Download, FileSearch } from "lucide-react";
import { useDashboardData } from "@/lib/data-context";
import { GlassCard } from "@/components/ui/GlassCard";
import { exportRawCsv } from "@/lib/export";
import { cn } from "@/lib/cn";
import { SourceViewerModal, type SourceViewerTarget } from "./SourceViewerModal";
import { RefreshDataPanel } from "./RefreshDataPanel";
import { CreditRatingsLineage } from "./CreditRatingsLineage";
import type { BankData, QuarterMetrics, MetricMeta } from "@/types/metrics";

export function SourcesTab() {
  const { banks, metricsMeta } = useDashboardData();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [viewerTarget, setViewerTarget] = useState<SourceViewerTarget | null>(null);

  const rows = useMemo(() => {
    const list = banks
      .filter((b) => bankFilter === "all" || b.bankId === bankFilter)
      .flatMap((bank) => bank.quarters.map((q) => ({ bank, q })));
    return list.sort((a, b) => b.q.periodEnd.localeCompare(a.q.periodEnd));
  }, [banks, bankFilter]);

  function resolveTarget(bank: BankData, q: QuarterMetrics, m: MetricMeta): SourceViewerTarget {
    const ref = q.sourceRefs?.[m.key];
    return {
      url: ref?.url ?? q.reportUrl,
      page: ref?.page,
      searchText: ref?.searchText,
      anchorText: ref?.anchorText,
      label: `${bank.bankName} · ${q.period} · ${m.label}`,
    };
  }

  return (
    <div className="space-y-4">
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5" glow>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-up/10">
            <ShieldCheck className="size-5 text-up" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-text-primary">Data Lineage &amp; Verifiability</h2>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="inline-block size-1.5 rounded-full bg-rbc-cyan" /> Click any figure to open its exact source page
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={bankFilter}
            onChange={(e) => setBankFilter(e.target.value)}
            className="rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-rbc-cyan/60"
          >
            <option value="all">All institutions</option>
            {banks.map((b) => (
              <option key={b.bankId} value={b.bankId}>
                {b.bankName}
              </option>
            ))}
          </select>
          <button
            onClick={() => exportRawCsv(banks, metricsMeta)}
            className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
          >
            <Download className="size-3.5" /> Export full CSV
          </button>
          <RefreshDataPanel />
        </div>
      </GlassCard>

      <GlassCard className="p-2 sm:p-4">
        <div className="max-h-[640px] space-y-2 overflow-y-auto">
          {rows.map(({ bank, q }) => {
            const key = `${bank.bankId}-${q.period}`;
            const isOpen = openKey === key;
            const noteCount = q.notes ? Object.keys(q.notes).length : 0;
            return (
              <div key={key} className="rounded-xl border border-border-soft bg-surface/40">
                <button
                  onClick={() => setOpenKey(isOpen ? null : key)}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-block size-2.5 rounded-full" style={{ background: bank.colorHex }} />
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {bank.bankName} <span className="text-text-muted">&middot; {q.period}</span>
                      </p>
                      <p className="text-xs text-text-muted">
                        {q.reportName} &middot; retrieved {new Date(q.retrievedAt).toLocaleDateString("en-CA")}
                        {noteCount > 0 && <span className="ml-2 text-warn">{noteCount} caveat{noteCount > 1 ? "s" : ""}</span>}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={cn("size-4 text-text-muted transition-transform", isOpen && "rotate-180")} />
                </button>

                {isOpen && (
                  <div className="border-t border-border-soft p-4">
                    <div className="mb-3 flex flex-wrap gap-4 text-xs">
                      <a href={q.reportUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-rbc-cyan hover:underline">
                        <ExternalLink className="size-3" /> {q.reportName}
                      </a>
                      {q.supplementaryReportUrl && (
                        <a href={q.supplementaryReportUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-rbc-cyan hover:underline">
                          <ExternalLink className="size-3" /> {q.supplementaryReportName}
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                      {metricsMeta.map((m) => {
                        const v = q.metrics[m.key];
                        const note = q.notes?.[m.key];
                        const hasPreciseSource = !!q.sourceRefs?.[m.key]?.page;
                        return (
                          <button
                            key={m.key}
                            disabled={v == null}
                            onClick={() => setViewerTarget(resolveTarget(bank, q, m))}
                            className={cn(
                              "group relative rounded-lg bg-surface-2/60 p-2.5 text-left transition-colors",
                              v != null && "cursor-pointer hover:bg-surface-2 hover:ring-1 hover:ring-rbc-cyan/40"
                            )}
                          >
                            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
                              {m.shortLabel}
                              {v != null && (
                                <FileSearch
                                  className={cn(
                                    "size-2.5 opacity-0 transition-opacity group-hover:opacity-100",
                                    hasPreciseSource ? "text-rbc-cyan" : "text-text-muted"
                                  )}
                                />
                              )}
                            </p>
                            <p className="font-mono text-sm font-semibold text-text-primary tabular-nums">
                              {v != null ? `${v.toFixed(m.decimals)}${m.unit === "%" ? "%" : ""}` : "—"}
                            </p>
                            {note && <p className="mt-0.5 text-[10px] leading-snug text-warn">{note}</p>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      <CreditRatingsLineage />

      {viewerTarget && <SourceViewerModal target={viewerTarget} onClose={() => setViewerTarget(null)} />}
    </div>
  );
}
