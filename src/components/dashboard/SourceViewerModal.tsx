"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { rectFor, resolveRef, type RefLocation, type Rect } from "@/lib/source-match";

export interface SourceViewerTarget {
  url: string;
  page?: number; // when known, jump straight there; otherwise we search for searchText across the document
  searchText?: string;
  // Label text preceding the figure. When present the value is located *after* this
  // anchor, so a value that appears several times on a page (e.g. BMO reporting both
  // ROE and CET1 at 13.0%) still highlights the correct line.
  anchorText?: string;
  label: string;
}


export function SourceViewerModal({ target, onClose }: { target: SourceViewerTarget; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<import("pdfjs-dist").PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);

  const [status, setStatus] = useState<"loading" | "searching" | "ready" | "error">("loading");
  const [currentPage, setCurrentPage] = useState(target.page ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Where the citation resolved to, decided once by the shared resolver. Holding the
  // resolution rather than re-deciding per render is what keeps the viewer and the
  // exported evidence pack pointing at the same place.
  const [location, setLocation] = useState<RefLocation | null>(null);

  const proxiedUrl = `/api/pdf-proxy?url=${encodeURIComponent(target.url)}`;

  // Load the document and resolve the citation to a page, once.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      if (cancelled) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdfjsLib.getDocument({ url: proxiedUrl });
      loadingTaskRef.current = task;
      try {
        const doc = await task.promise;
        if (cancelled) return;
        pdfRef.current = doc;
        setNumPages(doc.numPages);

        if (target.searchText) {
          if (!target.page) setStatus("searching");
          const resolved = await resolveRef(pdfjsLib, doc, target);
          if (cancelled) return;
          setLocation(resolved);
          setCurrentPage(Math.min(Math.max(resolved.pageResolved ?? target.page ?? 1, 1), doc.numPages));
        } else {
          setCurrentPage(Math.min(Math.max(target.page ?? 1, 1), doc.numPages));
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxiedUrl]);

  // Render the current page, and draw the highlight when this is the resolved page.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current) return;
    let cancelled = false;

    (async () => {
      const doc = pdfRef.current!;
      const page = await doc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Two renders must never share a canvas: pdf.js composites into it, so an
      // un-cancelled earlier task corrupts the output (it renders mirrored/garbled).
      renderTaskRef.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        return; // superseded by a newer render
      }
      if (cancelled) return;

      // The box is stored as a fraction of the page, so it lands correctly at whatever
      // scale this viewport happens to use.
      setRect(location?.bbox && location.pageResolved === currentPage ? rectFor(location.bbox, viewport) : null);
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [status, currentPage, location]);

  const searchMissed = !!target.searchText && !!location && location.status !== "located";

  useEffect(() => {
    if (rect) {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [rect]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="glass-panel glow-ring flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        >
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-3.5">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold text-text-primary">{target.label}</p>
              <p className="text-[11px] text-text-muted">
                {status === "ready" && `Page ${currentPage} of ${numPages}`}
                {status === "loading" && "Loading source document..."}
                {status === "searching" && "Searching the document for this figure..."}
                {status === "error" && "Could not load the source document"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={target.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
              >
                <ExternalLink className="size-3.5" /> Open original
              </a>
              <button
                onClick={onClose}
                className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-auto bg-black/30 p-6">
            {(status === "loading" || status === "searching") && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
                <Loader2 className="size-6 animate-spin" />
                {status === "searching" && <p className="text-xs">Scanning pages for a match...</p>}
              </div>
            )}
            {status === "error" && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-text-muted">
                <p>This document couldn&apos;t be loaded in the viewer.</p>
                <a href={target.url} target="_blank" rel="noopener noreferrer" className="text-rbc-cyan hover:underline">
                  Open the original source instead
                </a>
              </div>
            )}
            {status === "ready" && (
              <div className="relative mx-auto w-fit">
                <canvas ref={canvasRef} className="rounded-lg shadow-2xl" />
                {rect && (
                  <div
                    ref={highlightRef}
                    className="pointer-events-none absolute rounded-[3px] border-2 border-[#f59e0b]"
                    style={{
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                      boxShadow: "0 0 0 4px rgba(250, 204, 21, 0.6), 0 0 26px 8px rgba(250, 204, 21, 0.45)",
                    }}
                  >
                    {/* Highlighter-marker fill: multiply keeps the underlying figure
                        crisp and dark instead of washing it out with a flat overlay. */}
                    <div
                      className="absolute inset-0 rounded-[2px]"
                      style={{ backgroundColor: "rgba(250, 204, 21, 0.5)", mixBlendMode: "multiply" }}
                    />
                  </div>
                )}
              </div>
            )}
            {status === "ready" && searchMissed && (
              <p className="mx-auto mt-3 w-fit rounded-lg bg-warn/10 px-3 py-1.5 text-center text-xs text-warn">
                Couldn&apos;t pinpoint the exact figure automatically — browse the document below, or open the original to verify manually.
              </p>
            )}
          </div>

          {status === "ready" && numPages > 1 && (
            <div className="flex items-center justify-center gap-3 border-t border-border-soft p-3">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="flex size-8 items-center justify-center rounded-full border border-border-soft bg-surface text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs text-text-muted tabular-nums">
                {currentPage} / {numPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages}
                className="flex size-8 items-center justify-center rounded-full border border-border-soft bg-surface text-text-secondary transition-colors hover:border-rbc-cyan/50 hover:text-text-primary disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
