"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Presentation, FileText, Loader2, Check, Wand2 } from "lucide-react";
import { useDashboardData } from "@/lib/data-context";
import { GlassCard } from "@/components/ui/GlassCard";
import { buildPptx, buildPdf, type DeckRequest } from "@/lib/deck-builder";
import type { MetricKey } from "@/types/metrics";
import { cn } from "@/lib/cn";

const CHART_OPTIONS: { key: keyof DeckRequest["charts"]; label: string; hint: string }[] = [
  { key: "table", label: "Comparison table", hint: "All chosen metrics side by side" },
  { key: "ranking", label: "Ranking charts", hint: "One bar chart per metric" },
  { key: "trend", label: "Trend charts", hint: "Last 8 quarters per metric" },
  { key: "heatmap", label: "Standing heat map", hint: "Value + rank per bank" },
];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ExportDeckPage({ onClose }: { onClose: () => void }) {
  const { banks, metricsMeta, periods } = useDashboardData();
  const latest = periods[periods.length - 1]?.period ?? "";

  const [bankIds, setBankIds] = useState<string[]>(banks.map((b) => b.bankId));
  const [metricKeys, setMetricKeys] = useState<MetricKey[]>(
    ["cet1Ratio", "totalCapitalRatio", "leverageRatio", "lcr", "nsfr", "roe", "nim", "efficiencyRatio"].filter((k) =>
      metricsMeta.some((m) => m.key === k)
    ) as MetricKey[]
  );
  const [period, setPeriod] = useState(latest);
  const [charts, setCharts] = useState({ table: true, ranking: true, trend: true, heatmap: true });
  const [instructions, setInstructions] = useState("");
  const [title, setTitle] = useState("Canadian Peer Benchmarking");
  const [subtitle, setSubtitle] = useState("RBC Corporate Treasury · Capital, liquidity and profitability");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [accent, setAccent] = useState("#0051A5");
  const [busy, setBusy] = useState<null | "pptx" | "pdf" | "both">(null);
  const [done, setDone] = useState<string | null>(null);

  const req: DeckRequest = useMemo(
    () => ({ title, subtitle, bankIds, metricKeys, period, charts, instructions, accent, theme }),
    [title, subtitle, bankIds, metricKeys, period, charts, instructions, accent, theme]
  );

  const slideCount = useMemo(() => {
    let n = 4; // title + contents + executive summary + sources
    if (charts.table) n += 1;
    if (charts.heatmap) n += 1;
    if (charts.ranking) n += metricKeys.length + 1; // + section divider
    if (charts.trend) n += metricKeys.length + 1;
    return n;
  }, [charts, metricKeys.length]);

  const canGenerate = bankIds.length > 0 && metricKeys.length > 0 && !!period;

  async function generate(kind: "pptx" | "pdf" | "both") {
    if (!canGenerate) return;
    setBusy(kind);
    setDone(null);
    try {
      const stamp = period.replace(/\s+/g, "-");
      if (kind === "pptx" || kind === "both") {
        download(await buildPptx(req, banks, metricsMeta), `RBC-Treasury-IQ-${stamp}.pptx`);
      }
      if (kind === "pdf" || kind === "both") {
        download(buildPdf(req, banks, metricsMeta), `RBC-Treasury-IQ-${stamp}.pdf`);
      }
      setDone(kind === "both" ? "PowerPoint and PDF downloaded." : kind === "pptx" ? "PowerPoint downloaded." : "PDF downloaded.");
    } catch {
      setDone("Something went wrong generating the file.");
    } finally {
      setBusy(null);
    }
  }

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Lock the page behind the builder while it is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Rendered through a portal: the header is a sticky, stacked element, so an overlay
  // nested inside it would be trapped beneath the dashboard.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[70] overflow-y-auto bg-base/95 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-text-primary">Build a presentation</h1>
            <p className="mt-1 text-sm text-text-muted">
              Choose the institutions, metrics and visuals you need. Treasury IQ assembles a formatted PowerPoint
              (with native, editable charts) and a matching PDF — every figure sourced from the banks&apos; own disclosures.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* deck details */}
          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold text-text-primary">1. Deck details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-rbc-cyan/60" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Subtitle</span>
                <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="w-full rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-rbc-cyan/60" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Quarter</span>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-rbc-cyan/60">
                  {[...periods].reverse().map((p) => <option key={p.period} value={p.period}>{p.period}</option>)}
                </select>
              </label>
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Slide theme</span>
                  <select value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark")} className="w-full rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-rbc-cyan/60">
                    <option value="light">Light (print-friendly)</option>
                    <option value="dark">Dark (on-screen)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Accent</span>
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-[38px] w-16 cursor-pointer rounded-lg border border-border-soft bg-surface p-1" />
                </label>
              </div>
            </div>
          </GlassCard>

          {/* banks */}
          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold text-text-primary">
              2. Institutions <span className="font-normal text-text-muted">({bankIds.length} selected)</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {banks.map((b) => {
                const on = bankIds.includes(b.bankId);
                return (
                  <button
                    key={b.bankId}
                    onClick={() => setBankIds(toggle(bankIds, b.bankId))}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                      on ? "text-white" : "border-border-soft bg-surface/40 text-text-muted hover:text-text-secondary"
                    )}
                    style={on ? { background: `${b.colorHex}25`, borderColor: `${b.colorHex}80`, color: "#fff" } : undefined}
                  >
                    <span className="inline-block size-2 rounded-full" style={{ background: b.colorHex }} />
                    {b.ticker}
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {/* metrics */}
          <GlassCard className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-text-primary">
                3. Metrics <span className="font-normal text-text-muted">({metricKeys.length} selected)</span>
              </h2>
              <div className="flex gap-2 text-[11px]">
                <button onClick={() => setMetricKeys(metricsMeta.map((m) => m.key))} className="rounded-full border border-border-soft px-2.5 py-1 text-text-muted hover:text-text-primary">Select all</button>
                <button onClick={() => setMetricKeys([])} className="rounded-full border border-border-soft px-2.5 py-1 text-text-muted hover:text-text-primary">Clear</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {metricsMeta.map((m) => {
                const on = metricKeys.includes(m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => setMetricKeys(toggle(metricKeys, m.key))}
                    title={m.label}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                      on ? "border-rbc-cyan/60 bg-rbc-cyan/15 text-text-primary" : "border-border-soft bg-surface/40 text-text-muted hover:text-text-secondary"
                    )}
                  >
                    {m.shortLabel}
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {/* charts */}
          <GlassCard className="p-5">
            <h2 className="mb-3 font-display text-sm font-semibold text-text-primary">4. What to include</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHART_OPTIONS.map((c) => {
                const on = charts[c.key];
                return (
                  <button
                    key={c.key}
                    onClick={() => setCharts({ ...charts, [c.key]: !on })}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      on ? "border-rbc-cyan/50 bg-rbc-cyan/10" : "border-border-soft bg-surface/40 hover:border-border-glow"
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-rbc-cyan bg-rbc-cyan text-white" : "border-border-soft")}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-text-primary">{c.label}</span>
                      <span className="block text-[11px] text-text-muted">{c.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </GlassCard>

          {/* instructions */}
          <GlassCard className="p-5">
            <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-text-primary">
              <Wand2 className="size-4 text-rbc-cyan" /> 5. How should it look?
            </h2>
            <p className="mb-2 text-xs text-text-muted">
              Free-text direction — audience, tone, emphasis, ordering. Recorded on the cover page so the deck states how it was prepared.
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="e.g. For the Corporate Treasury OC. Lead with capital, keep it high level, emphasise where RBC trails peers."
              className="w-full resize-y rounded-lg border border-border-soft bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted/60 focus:border-rbc-cyan/60"
            />
          </GlassCard>

          {/* generate */}
          <GlassCard className="flex flex-wrap items-center justify-between gap-3 p-5" glow>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {canGenerate ? `${slideCount} slides ready` : "Select at least one institution and metric"}
              </p>
              {done && <p className="mt-0.5 text-xs text-up">{done}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => generate("pptx")}
                disabled={!canGenerate || busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-50"
              >
                {busy === "pptx" ? <Loader2 className="size-3.5 animate-spin" /> : <Presentation className="size-3.5" />} PowerPoint
              </button>
              <button
                onClick={() => generate("pdf")}
                disabled={!canGenerate || busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-50"
              >
                {busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} PDF
              </button>
              <button
                onClick={() => generate("both")}
                disabled={!canGenerate || busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2 text-xs font-semibold text-white shadow-[0_0_24px_-6px_rgba(0,182,241,0.6)] transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {busy === "both" ? <Loader2 className="size-3.5 animate-spin" /> : <Presentation className="size-3.5" />} Generate both
              </button>
            </div>
          </GlassCard>
        </div>
      </div>
    </motion.div>,
    document.body
  );
}
