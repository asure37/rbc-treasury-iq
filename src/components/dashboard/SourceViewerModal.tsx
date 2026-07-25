"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";

export interface SourceViewerTarget {
  url: string;
  page?: number; // when known, jump straight there; otherwise we search for searchText across the document
  searchText?: string;
  label: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAX_SCAN_PAGES = 150;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function pageContainsText(page: import("pdfjs-dist").PDFPageProxy, searchText: string): Promise<boolean> {
  const textContent = await page.getTextContent();
  const combined = (textContent.items as { str: string }[]).map((i) => i.str).join(" ");
  return normalize(combined).includes(normalize(searchText));
}

// Renders one page of a PDF to canvas and, when a searchText is given, finds
// it among that page's text items and returns a pixel rect (in viewport
// space) to draw a highlight over — this is real text search against the
// actual document content, not a guess.
async function findHighlightRect(pdfjsLib: typeof import("pdfjs-dist"), page: import("pdfjs-dist").PDFPageProxy, viewport: import("pdfjs-dist").PageViewport, searchText: string): Promise<Rect | null> {
  const textContent = await page.getTextContent();
  const items = textContent.items as { str: string; transform: number[]; width: number; height: number }[];

  // Build the searchable string and the per-item offset ranges in the SAME
  // (normalized) coordinate space. Building `combined` from raw item strings but
  // searching a separately-normalized copy makes the match index drift wherever
  // whitespace was collapsed — which selects text items several rows away from
  // the real match. Normalizing per item keeps offsets aligned.
  let combined = "";
  const ranges: { start: number; end: number; item: (typeof items)[number] }[] = [];
  for (const item of items) {
    const token = normalize(item.str);
    if (!token) continue; // skip whitespace-only items so they don't shift offsets
    const start = combined.length;
    combined += token + " ";
    ranges.push({ start, end: combined.length, item });
  }

  const normalizedSearch = normalize(searchText);
  const idx = combined.indexOf(normalizedSearch);
  if (idx === -1 || !normalizedSearch) return null;

  const matchEnd = idx + normalizedSearch.length;
  const matchingItems = ranges.filter((r) => r.end > idx && r.start < matchEnd).map((r) => r.item);
  if (matchingItems.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of matchingItems) {
    const t = pdfjsLib.Util.transform(viewport.transform, item.transform);
    // item.width / item.height are in unscaled PDF page units, so they scale by the
    // viewport scale only. The composed text matrix (t[0..3]) already bakes in the
    // font size — using its scale here would over-size the box by roughly the font
    // size, ballooning a one-line highlight into a multi-row block above the figure.
    const width = item.width * viewport.scale;
    const height = Math.hypot(t[2], t[3]); // rendered line height in px (baseline → ascent)
    const x = t[4];
    const y = t[5]; // text baseline, in canvas coordinates
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
    minY = Math.min(minY, y - height);
    maxY = Math.max(maxY, y);
  }

  return { left: minX - 4, top: minY - 4, width: maxX - minX + 8, height: maxY - minY + 8 };
}

export function SourceViewerModal({ target, onClose }: { target: SourceViewerTarget; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<import("pdfjs-dist").PDFDocumentLoadingTask | null>(null);

  const [status, setStatus] = useState<"loading" | "searching" | "ready" | "error">("loading");
  const [currentPage, setCurrentPage] = useState(target.page ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [searchMissed, setSearchMissed] = useState(false);

  const proxiedUrl = `/api/pdf-proxy?url=${encodeURIComponent(target.url)}`;

  // Load the document, then (if we don't already know the page) scan for
  // searchText across the document to find which page it's on.
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

        if (!target.page && target.searchText) {
          setStatus("searching");
          const cap = Math.min(doc.numPages, MAX_SCAN_PAGES);
          let found = false;
          for (let p = 1; p <= cap; p++) {
            if (cancelled) return;
            const page = await doc.getPage(p);
            if (await pageContainsText(page, target.searchText)) {
              setCurrentPage(p);
              found = true;
              break;
            }
          }
          if (!found) setSearchMissed(true);
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

  // Render the current page and, if we have a searchText, highlight it.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current) return;
    let cancelled = false;

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const doc = pdfRef.current!;
      const page = await doc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;

      if (target.searchText) {
        const found = await findHighlightRect(pdfjsLib, page, viewport, target.searchText);
        if (cancelled) return;
        setRect(found);
        if (found) setSearchMissed(false);
      } else {
        setRect(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, currentPage, target.searchText]);

  // If a known page number didn't contain the search text, try its immediate
  // neighbors once — reports are occasionally off-by-one against the page
  // number recorded during research.
  useEffect(() => {
    if (!rect && status === "ready" && target.page && target.searchText && currentPage === target.page && numPages) {
      let cancelled = false;
      (async () => {
        const pdfjsLib = await import("pdfjs-dist");
        const doc = pdfRef.current;
        if (!doc) return;
        for (const candidate of [target.page! + 1, target.page! - 1]) {
          if (candidate < 1 || candidate > numPages) continue;
          const page = await doc.getPage(candidate);
          const viewport = page.getViewport({ scale: 1.6 });
          const found = await findHighlightRect(pdfjsLib, page, viewport, target.searchText!);
          if (found && !cancelled) {
            setCurrentPage(candidate);
            return;
          }
        }
        if (!cancelled) setSearchMissed(true);
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, status]);

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
                    className="pointer-events-none absolute animate-pulse-glow rounded-md border-2 border-rbc-cyan bg-rbc-cyan/20 shadow-[0_0_30px_rgba(0,182,241,0.6)]"
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                  />
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
