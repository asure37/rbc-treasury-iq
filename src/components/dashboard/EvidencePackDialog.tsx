"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, FileText, Table, Braces, Loader2, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  buildPackPdf,
  buildRegisterFiles,
  collectEvidence,
  packIdFor,
  planEvidence,
  EXCEPTION_LABEL,
  type EvidenceItem,
  type EvidencePackRequest,
  type EvidenceRecord,
  type ExceptionClass,
  type SourceDocument,
} from "@/lib/evidence-pack";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  title: string;
  subtitle: string;
  scopeLabel: string;
  items: EvidenceItem[];
  preparedBy: string;
  fileStem: string;
  onClose: () => void;
}

export function EvidencePackDialog({ title, subtitle, scopeLabel, items, preparedBy, fileStem, onClose }: Props) {
  const [registerOnly, setRegisterOnly] = useState(false);
  const [maxScreenshots, setMaxScreenshots] = useState(25);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [result, setResult] = useState<{
    packId: string;
    records: EvidenceRecord[];
    documents: SourceDocument[];
    files: { name: string; blob: Blob; kind: "pdf" | "csv" | "json" }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(() => planEvidence(items), [items]);

  const run = useCallback(async () => {
    if (busy || !items.length) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: items.length, label: "Starting" });

    const req: EvidencePackRequest = {
      title,
      subtitle,
      preparedBy,
      scopeLabel,
      items,
      maxScreenshots,
      budgetMs: 240_000,
      registerOnly,
    };

    try {
      const packId = await packIdFor(req);
      const { records, documents } = await collectEvidence(req, (done, total, label) => setProgress({ done, total, label }));

      // Register first: if PDF assembly runs the tab out of memory, the reviewer still
      // has the log.
      setProgress({ done: items.length, total: items.length, label: "Writing the register" });
      const { csv, json } = buildRegisterFiles(req, records, documents, packId);
      const csvName = `${fileStem}-${packId}-register.csv`;
      const jsonName = `${fileStem}-${packId}-log.json`;
      download(csv, csvName);
      await sleep(450); // browsers block a burst of downloads; space them out
      download(json, jsonName);

      setProgress({ done: items.length, total: items.length, label: "Assembling the evidence pack" });
      await sleep(30); // let the progress paint before jsPDF blocks the thread
      const pdf = buildPackPdf(req, records, documents, packId);
      const pdfName = `${fileStem}-${packId}-evidence-pack.pdf`;
      await sleep(450);
      download(pdf, pdfName);

      setResult({
        packId,
        records,
        documents,
        files: [
          { name: pdfName, blob: pdf, kind: "pdf" },
          { name: csvName, blob: csv, kind: "csv" },
          { name: jsonName, blob: json, kind: "json" },
        ],
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(
        /memory|allocation|Invalid string length/i.test(m)
          ? "The pack was too large to assemble in the browser. Reduce the page-image limit, or narrow the scope, and try again."
          : "The pack could not be built. Try again, or use the register-only option."
      );
    } finally {
      setBusy(false);
    }
  }, [busy, items, title, subtitle, preparedBy, scopeLabel, maxScreenshots, registerOnly, fileStem]);

  const summary = useMemo(() => {
    if (!result) return null;
    const located = result.records.filter((r) => r.matchMethod !== "none" && r.pageResolved).length;
    const imaged = result.records.filter((r) => r.pageImage).length;
    const byClass = new Map<ExceptionClass, number>();
    for (const r of result.records) for (const e of r.exceptions) byClass.set(e, (byClass.get(e) ?? 0) + 1);
    return { located, imaged, byClass: [...byClass.entries()].sort((a, b) => b[1] - a[1]) };
  }, [result]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-soft bg-base shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-soft px-6 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 items-center justify-center rounded-xl bg-up/10">
                <ShieldCheck className="size-4.5 text-up" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-text-primary">Export evidence pack</h2>
                <p className="mt-0.5 text-xs text-text-muted">{scopeLabel}</p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!result && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border-soft bg-surface/50 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted">Figures in scope</p>
                    <p className="font-display text-2xl font-bold text-text-primary tabular-nums">{plan.figures}</p>
                  </div>
                  <div className="rounded-xl border border-border-soft bg-surface/50 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted">Documents to retrieve</p>
                    <p className="font-display text-2xl font-bold text-text-primary tabular-nums">{registerOnly ? 0 : plan.documents}</p>
                  </div>
                </div>

                {!registerOnly && plan.documents > 8 && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Each bank-quarter is its own document, so this fetches {plan.documents} PDFs — several are 100+ page annual reports. Expect a
                      few minutes and a large download. Keep this tab in the foreground.
                    </span>
                  </p>
                )}

                <div className="mt-5 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">What to produce</p>
                  <button
                    onClick={() => setRegisterOnly(false)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      !registerOnly ? "border-rbc-cyan/50 bg-rbc-cyan/10" : "border-border-soft bg-surface/40 hover:border-border-soft"
                    )}
                  >
                    <span className={cn("mt-0.5 size-3.5 shrink-0 rounded-full border-2", !registerOnly ? "border-rbc-cyan bg-rbc-cyan" : "border-text-muted")} />
                    <span>
                      <span className="block text-sm font-medium text-text-primary">Full pack, with page images</span>
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        Re-fetches every source, re-locates each figure, and captures the page with the figure ringed. Produces the PDF, the register
                        CSV and the JSON log.
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setRegisterOnly(true)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      registerOnly ? "border-rbc-cyan/50 bg-rbc-cyan/10" : "border-border-soft bg-surface/40"
                    )}
                  >
                    <span className={cn("mt-0.5 size-3.5 shrink-0 rounded-full border-2", registerOnly ? "border-rbc-cyan bg-rbc-cyan" : "border-text-muted")} />
                    <span>
                      <span className="block text-sm font-medium text-text-primary">Register only — instant</span>
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        The log of what the dashboard records, with no source fetching. Every row is marked as not re-verified.
                      </span>
                    </span>
                  </button>
                </div>

                {!registerOnly && (
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Page images to capture</p>
                    <div className="mt-2 flex gap-2">
                      {[10, 25, 50, 100].map((n) => (
                        <button
                          key={n}
                          onClick={() => setMaxScreenshots(n)}
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                            maxScreenshots === n
                              ? "border-rbc-cyan/50 bg-rbc-cyan/10 text-rbc-cyan"
                              : "border-border-soft bg-surface text-text-secondary hover:text-text-primary"
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-text-muted">
                      Every figure is still re-verified and appears in the register. Beyond this limit the pack records that the image was omitted,
                      rather than dropping the figure.
                    </p>
                  </div>
                )}
              </>
            )}

            {busy && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-rbc-cyan" />
                    {progress.label}
                  </span>
                  <span className="tabular-nums text-text-muted">
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan transition-[width] duration-200"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}

            {result && summary && (
              <div>
                <div className="rounded-xl border border-up/30 bg-up/5 p-4">
                  <p className="text-sm font-semibold text-text-primary">
                    Pack {result.packId} — {result.records.length} figures
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {summary.located} re-located in their source at export time
                    {registerOnly ? "" : `, ${summary.imaged} captured as page images`} across {result.documents.length} document
                    {result.documents.length === 1 ? "" : "s"}.
                  </p>
                </div>

                {summary.byClass.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Qualifications recorded</p>
                    <div className="mt-2 space-y-1.5">
                      {summary.byClass.map(([cls, n]) => (
                        <div key={cls} className="flex items-start justify-between gap-3 rounded-lg bg-surface/50 px-3 py-2">
                          <span className="text-[11px] text-text-secondary">{EXCEPTION_LABEL[cls]}</span>
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-warn tabular-nums">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Files</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    All three downloaded automatically. If your browser blocked any of them, use the buttons below.
                  </p>
                  <div className="mt-2 space-y-2">
                    {result.files.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => download(f.blob, f.name)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border-soft bg-surface/50 px-3 py-2.5 text-left transition-colors hover:border-rbc-cyan/40"
                      >
                        {f.kind === "pdf" ? (
                          <FileText className="size-4 shrink-0 text-rbc-cyan" />
                        ) : f.kind === "csv" ? (
                          <Table className="size-4 shrink-0 text-up" />
                        ) : (
                          <Braces className="size-4 shrink-0 text-text-muted" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-text-primary">{f.name}</span>
                          <span className="block text-[10px] text-text-muted">{(f.blob.size / 1024).toFixed(0)} KB</span>
                        </span>
                        <Download className="size-3.5 shrink-0 text-text-muted" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border-soft px-6 py-4">
            <p className="text-[11px] text-text-muted">
              {result ? "Every figure in scope produced a record." : "Nothing is estimated — figures that cannot be evidenced are listed as exceptions."}
            </p>
            {result ? (
              <button
                onClick={onClose}
                className="rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03]"
              >
                Done
              </button>
            ) : (
              <button
                onClick={run}
                disabled={busy || !items.length}
                className="flex items-center gap-2 rounded-full bg-gradient-to-r from-rbc-blue to-rbc-cyan px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                {busy ? "Building…" : registerOnly ? "Export register" : "Build evidence pack"}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
