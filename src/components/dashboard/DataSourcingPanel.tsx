"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, ShieldCheck, ShieldAlert, ShieldQuestion, FileSearch, ExternalLink, Loader2, Radar } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { SourceViewerModal, type SourceViewerTarget } from "./SourceViewerModal";

interface Verification {
  status: "confirmed" | "not_found" | "unreachable" | "unsupported";
  page?: number;
  detail: string;
  isPdf: boolean;
}
interface Finding {
  label: string;
  entity: string;
  period: string;
  value: string;
  labelText?: string;
  quote: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: string;
  asOf?: string;
  notes?: string;
  verification: Verification;
  provenance?: "first_party" | "third_party";
}

const EXAMPLES = [
  "Manulife's LICAT total ratio for Q2 2026",
  "Sun Life's Q2 2026 assets under management",
  "RBC Capital Markets segment net income, Q2 2026",
  "Intact Financial's combined ratio for Q2 2026",
];

const SOURCE_TYPE_LABEL: Record<string, string> = {
  investor_report: "Investor report",
  supplementary_financials: "Supplementary financials",
  regulatory_filing: "Regulatory filing",
  earnings_release: "Earnings release",
  earnings_call: "Earnings call",
  press_release: "Press release",
  website: "Website",
  other: "Source",
};

export function DataSourcingPanel() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<SourceViewerTarget | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setFindings([]);
    setStatus("Starting…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        setError((await res.json().catch(() => null))?.error ?? "Discovery request failed.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const msg = JSON.parse(l) as { event: string; data: unknown };
          if (msg.event === "status") setStatus(msg.data as string);
          else if (msg.event === "text") setText((t) => t + (msg.data as string));
          else if (msg.event === "finding") setFindings((f) => [...f, msg.data as Finding]);
          else if (msg.event === "error") setError(msg.data as string);
          else if (msg.event === "done") setStatus(null);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Discovery failed. Please try again.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rbc-cyan/10">
          <Radar className="size-5 text-rbc-cyan" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-text-primary">Source Any Figure</h3>
          <p className="text-xs text-text-muted">
            Ask for any metric, any company, any period. Treasury IQ searches primary sources — investor
            reports, supplementary financials, regulatory filings, earnings releases and calls — reads the
            document, verifies the figure is really in it, and shows you exactly where.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Manulife's LICAT ratio for Q2 2026"
            disabled={busy}
            className="w-full rounded-xl border border-border-soft bg-surface/70 py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/60 focus:border-rbc-cyan/60 disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}
          {busy ? "Sourcing…" : "Find & verify"}
        </button>
      </form>

      {!busy && findings.length === 0 && !text && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQuery(ex);
                run(ex);
              }}
              className="rounded-full border border-border-soft bg-surface/50 px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {status && (
        <p className="mt-3 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="size-3.5 animate-spin text-rbc-cyan" /> {status}
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}

      {findings.map((f, i) => {
        const v = f.verification;
        const ok = v.status === "confirmed";
        const Icon = ok ? ShieldCheck : v.status === "not_found" ? ShieldAlert : ShieldQuestion;
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-xl border border-border-soft bg-surface/50 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-text-muted">
                  {f.entity} &middot; {f.period}
                </p>
                <p className="font-display text-sm font-semibold text-text-primary">{f.label}</p>
                <p className="mt-1 font-display text-2xl font-bold text-text-primary tabular-nums">{f.value}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  ok ? "bg-up/10 text-up" : v.status === "not_found" ? "bg-warn/10 text-warn" : "bg-text-muted/10 text-text-muted"
                }`}
              >
                <Icon className="size-3.5" />
                {ok ? "Verified in source" : v.status === "not_found" ? "Not found in source" : "Unverified"}
              </span>
            </div>

            <blockquote className="mt-3 border-l-2 border-rbc-cyan/40 pl-3 text-xs italic text-text-secondary">
              &ldquo;{f.quote}&rdquo;
            </blockquote>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span className="rounded-full border border-border-soft px-2 py-0.5">
                {SOURCE_TYPE_LABEL[f.sourceType] ?? "Source"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ${
                  f.provenance === "first_party" ? "bg-up/10 text-up" : "bg-warn/10 text-warn"
                }`}
                title={
                  f.provenance === "first_party"
                    ? "Published by the issuing organisation"
                    : "Third-party source — prefer the issuer's own filing where available"
                }
              >
                {f.provenance === "first_party" ? "Issuer's own document" : "Third-party source"}
              </span>
              <span className="truncate">{f.sourceName}</span>
              {v.page && <span>&middot; page {v.page}</span>}
              {f.asOf && <span>&middot; as at {f.asOf}</span>}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">{v.detail}</p>
            {f.notes && <p className="mt-1 text-[11px] text-text-muted">Note: {f.notes}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              {ok && v.isPdf && (
                <button
                  onClick={() =>
                    setViewer({
                      url: f.sourceUrl,
                      page: v.page,
                      searchText: f.value,
                      anchorText: f.labelText,
                      label: `${f.entity} · ${f.period} · ${f.label}`,
                    })
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-rbc-cyan/40 bg-rbc-cyan/10 px-2.5 py-1.5 text-xs font-medium text-rbc-cyan transition-colors hover:bg-rbc-cyan/20"
                >
                  <FileSearch className="size-3.5" /> View highlighted in source
                </button>
              )}
              <a
                href={f.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
              >
                <ExternalLink className="size-3.5" /> Open original
              </a>
            </div>
          </motion.div>
        );
      })}

      {text && <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">{text}</p>}

      {viewer && <SourceViewerModal target={viewer} onClose={() => setViewer(null)} />}
    </GlassCard>
  );
}
