"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, CheckCircle2, AlertTriangle, CircleSlash } from "lucide-react";
import { useDashboardData } from "@/lib/data-context";
import { cn } from "@/lib/cn";
import type { ProposedQuarter, MetricCheck, SanityFlag } from "@/lib/quarters";
import type { MetricMeta } from "@/types/metrics";

type Phase = "idle" | "running" | "complete";

function formatValue(v: number | null | undefined, m: MetricMeta): string {
  if (v == null) return "—";
  if (m.unit === "$B") return `$${v.toLocaleString(undefined, { maximumFractionDigits: m.decimals })}B`;
  if (m.unit === "$M") return `$${v.toLocaleString(undefined, { maximumFractionDigits: m.decimals })}M`;
  return `${v.toFixed(m.decimals)}%`;
}

const SANITY_META: Record<SanityFlag, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "In range", className: "text-up", Icon: CheckCircle2 },
  "large-move": { label: "Large move", className: "text-warn", Icon: AlertTriangle },
  missing: { label: "Missing", className: "text-text-muted", Icon: CircleSlash },
  "out-of-range": { label: "Out of range", className: "text-down", Icon: AlertTriangle },
};

function SourceBadge({ verified }: { verified: boolean | null | undefined }) {
  if (verified === true)
    return (
      <span className="flex items-center gap-1 text-up" title="Figure found in the cited source document">
        <ShieldCheck className="size-3" /> Verified
      </span>
    );
  if (verified === false)
    return (
      <span className="flex items-center gap-1 text-warn" title="Figure not located in the cited source (worth checking)">
        <ShieldAlert className="size-3" /> Unconfirmed
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-text-muted" title="Source isn't a machine-readable PDF — the model's citation still applies">
      <ShieldQuestion className="size-3" /> Not checkable
    </span>
  );
}

function BankResultCard({ result, metricsMeta }: { result: ProposedQuarter; metricsMeta: MetricMeta[] }) {
  if (result.status === "not-available") {
    return (
      <div className="rounded-xl border border-border-soft bg-surface/40 p-4">
        <p className="text-sm font-semibold text-text-primary">
          {result.bankName} <span className="text-text-muted">· {result.targetPeriod}</span>
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
          <CircleSlash className="size-3.5" /> {result.message ?? "No new quarter available yet."}
        </p>
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="rounded-xl border border-down/30 bg-down/5 p-4">
        <p className="text-sm font-semibold text-text-primary">
          {result.bankName} <span className="text-text-muted">· {result.targetPeriod}</span>
        </p>
        <p className="mt-1 text-xs text-down">{result.message ?? "Couldn't pull this bank."}</p>
      </div>
    );
  }

  const present = metricsMeta.filter((m) => m.key in result.metrics || m.key in result.checks);
  return (
    <div className="rounded-xl border border-border-soft bg-surface/40 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">
          {result.bankName} <span className="text-text-muted">· {result.targetPeriod}</span>
        </p>
        {result.reportUrl && (
          <a href={result.reportUrl} target="_blank" rel="noreferrer" className="max-w-[60%] truncate text-[11px] text-rbc-cyan hover:underline">
            {result.reportName}
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {present.map((m) => {
          const check: MetricCheck | undefined = result.checks[m.key];
          const flag = check?.sanity ?? "ok";
          const sm = SANITY_META[flag];
          return (
            <div key={m.key} className="rounded-lg bg-surface-2/60 p-2.5" title={check?.detail}>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">{m.shortLabel}</p>
              <p className="font-mono text-sm font-semibold text-text-primary tabular-nums">{formatValue(result.metrics[m.key], m)}</p>
              <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                <span className={cn("flex items-center gap-0.5", sm.className)}>
                  <sm.Icon className="size-3" /> {sm.label}
                </span>
                <SourceBadge verified={check?.sourceVerified} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RefreshDataPanel() {
  const { metricsMeta } = useDashboardData();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusByBank, setStatusByBank] = useState<Record<string, string>>({});
  const [results, setResults] = useState<ProposedQuarter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufRef = useRef("");

  const proposed = results.filter((r) => r.status === "proposed");

  async function run() {
    setPhase("running");
    setResults([]);
    setStatusByBank({});
    setError(null);
    setApplyMessage(null);
    bufRef.current = "";

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bufRef.current += decoder.decode(value, { stream: true });
        const lines = bufRef.current.split("\n");
        bufRef.current = lines.pop() ?? "";
        for (const l of lines) {
          if (!l) continue;
          const msg = JSON.parse(l) as { t: string; v?: unknown; bankId?: string };
          if (msg.t === "status" && msg.bankId) {
            setStatusByBank((prev) => ({ ...prev, [msg.bankId!]: String(msg.v) }));
          } else if (msg.t === "bank") {
            setResults((prev) => [...prev, msg.v as ProposedQuarter]);
          } else if (msg.t === "error") {
            setError(String(msg.v));
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError("The refresh couldn't complete. Please try again.");
      }
    } finally {
      setPhase("complete");
    }
  }

  async function apply() {
    setApplying(true);
    setApplyMessage(null);
    try {
      const res = await fetch("/api/refresh/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: proposed }),
      });
      const data = (await res.json()) as { outcomes?: { bankId: string; applied: boolean; reason?: string }[] };
      const appliedCount = data.outcomes?.filter((o) => o.applied).length ?? 0;
      setApplyMessage(`${appliedCount} of ${proposed.length} update${proposed.length === 1 ? "" : "s"} written. Reload to see them on the dashboard.`);
    } catch {
      setApplyMessage("Failed to write updates.");
    } finally {
      setApplying(false);
    }
  }

  function close() {
    abortRef.current?.abort();
    setOpen(false);
    setPhase("idle");
    setResults([]);
    setStatusByBank({});
    setError(null);
    setApplyMessage(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-rbc-blue to-rbc-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_24px_-6px_rgba(0,182,241,0.6)] transition-transform hover:scale-[1.03] active:scale-95"
      >
        <RefreshCw className="size-3.5" /> Refresh data
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[60] flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm"
                onClick={close}
              >
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.97 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-panel glow-ring flex h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
                >
                  <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
                    <div>
                      <h3 className="font-display text-lg font-bold text-text-primary">Refresh dashboard data</h3>
                      <p className="text-xs text-text-muted">
                        Pulls each bank&apos;s next fiscal quarter from its primary disclosures, verifies figures against the source, and lets you review before anything is written.
                      </p>
                    </div>
                    <button onClick={close} className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {phase === "idle" && (
                      <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
                        <div className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-rbc-blue to-rbc-cyan">
                          <RefreshCw className="size-6 text-white" />
                        </div>
                        <p className="max-w-md text-sm text-text-secondary">
                          Check all six banks for their latest reported quarter. The assistant searches each bank&apos;s investor-relations disclosures, extracts every dashboard metric in the same format, and independently re-checks each figure against the cited source document.
                        </p>
                        <button
                          onClick={run}
                          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(0,182,241,0.6)] transition-transform hover:scale-[1.03] active:scale-95"
                        >
                          <RefreshCw className="size-4" /> Check for the latest quarter
                        </button>
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-2 rounded-xl border border-down/30 bg-down/5 p-4 text-sm text-down">
                        <AlertTriangle className="size-4 shrink-0" /> {error}
                      </div>
                    )}

                    {phase === "running" && (
                      <div className="space-y-2">
                        {Object.entries(statusByBank).map(([bankId, status]) => {
                          const done = results.some((r) => r.bankId === bankId);
                          if (done) return null;
                          return (
                            <div key={bankId} className="flex items-center gap-2 rounded-lg bg-surface/40 px-3 py-2 text-xs text-text-secondary">
                              <Loader2 className="size-3.5 animate-spin text-rbc-cyan" /> {status}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {results.map((r) => (
                      <BankResultCard key={r.bankId} result={r} metricsMeta={metricsMeta} />
                    ))}

                    {phase === "complete" && results.length > 0 && proposed.length === 0 && !error && (
                      <p className="rounded-xl bg-surface/40 p-4 text-center text-sm text-text-muted">
                        No new quarters are available to add right now — every bank&apos;s latest reported quarter is already on the dashboard.
                      </p>
                    )}
                  </div>

                  {phase === "complete" && proposed.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft p-4">
                      <p className="text-xs text-text-muted">
                        {proposed.length} bank{proposed.length === 1 ? "" : "s"} with a new quarter ready. Review the badges above, then apply.
                      </p>
                      <div className="flex items-center gap-2">
                        {applyMessage && <span className="text-xs text-up">{applyMessage}</span>}
                        {applyMessage ? (
                          <button
                            onClick={() => window.location.reload()}
                            className="rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95"
                          >
                            Reload dashboard
                          </button>
                        ) : (
                          <button
                            onClick={apply}
                            disabled={applying}
                            className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                          >
                            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                            {applying ? "Writing…" : "Apply verified updates"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
