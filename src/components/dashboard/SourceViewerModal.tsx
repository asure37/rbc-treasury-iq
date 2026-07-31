"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";

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

// Maximum distance (in normalized characters) between a label anchor and its value.
// Wide enough to cross a table row's intervening columns, tight enough that we never
// pair a label with a value from a different section.
const ANCHOR_WINDOW = 240;

// pdf.js emits a leading "$" as its own text item, so "$619,452" in the data becomes
// "$ 619,452" in the extracted stream; some documents likewise split the trailing "%"
// off its number. Try the recorded form first, then those spaced forms, then the bare
// number — most specific to least, so the tightest match wins.
function valueVariants(searchText: string): string[] {
  const v = normalize(searchText);
  const out = [v];
  if (v.includes("$")) {
    out.push(v.replace(/\$\s*/g, "$ "));
    out.push(v.replace(/\$\s*/g, "").trim());
  }
  if (v.includes("%")) {
    out.push(v.replace(/\s*%/g, " %"));
    out.push(v.replace(/\s*%/g, "").trim());
  }
  return out.filter((s, i, a) => s && a.indexOf(s) === i);
}

// A figure must not be a fragment of a longer number. Plain substring search happily
// finds "4.2" inside "c$4.233 billion", "4.7" inside "184.7 million shares" and "4.3"
// inside "$14.36 million" — all of which highlight a number we never cited.
function isWholeNumberMatch(hay: string, idx: number, len: number): boolean {
  const before = idx > 0 ? hay[idx - 1] : "";
  const after = hay[idx + len] ?? "";
  if (/[0-9.,]/.test(before)) return false;
  if (/[0-9]/.test(after)) return false;
  // "13.2" must not match the head of "13.25" / "13,250".
  if (/[.,]/.test(after) && /[0-9]/.test(hay[idx + len + 1] ?? "")) return false;
  return true;
}

function indexOfValue(hay: string, needle: string, from = 0): number {
  let i = hay.indexOf(needle, from);
  while (i !== -1) {
    if (isWholeNumberMatch(hay, i, needle.length)) return i;
    i = hay.indexOf(needle, i + 1);
  }
  return -1;
}

// Index and matched length of the value belonging to `anchorText`.
//
// When an anchor is given it is REQUIRED: if this page doesn't carry the metric's own
// label, we highlight nothing rather than the first number that happens to look right.
// Falling back to a bare match is how a leverage ratio of 4.3% ends up pointing at
// "the unemployment rate remained at 4.3% in April 2026" a page earlier.
function locateValue(combined: string, searchText: string, anchorText?: string): { idx: number; len: number } {
  const variants = valueVariants(searchText);
  if (anchorText) {
    const anchor = normalize(anchorText);
    let from = 0;
    while (from <= combined.length) {
      const aIdx = combined.indexOf(anchor, from);
      if (aIdx === -1) break;
      const searchStart = aIdx + anchor.length;
      for (const value of variants) {
        const vIdx = indexOfValue(combined, value, searchStart);
        if (vIdx !== -1 && vIdx - searchStart <= ANCHOR_WINDOW) return { idx: vIdx, len: value.length };
      }
      from = aIdx + 1;
    }
    return { idx: -1, len: 0 };
  }
  for (const value of variants) {
    const i = indexOfValue(combined, value);
    if (i !== -1) return { idx: i, len: value.length };
  }
  return { idx: -1, len: 0 };
}

// Normalized text of a page, plus per-item offsets, in one consistent space.
async function pageText(page: import("pdfjs-dist").PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  return (textContent.items as { str: string }[])
    .map((i) => normalize(i.str))
    .filter(Boolean)
    .join(" ");
}

async function pageContainsText(
  page: import("pdfjs-dist").PDFPageProxy,
  searchText: string,
  anchorText?: string
): Promise<boolean> {
  const combined = (await pageText(page)) + " ";
  if (anchorText && !combined.includes(normalize(anchorText))) return false;
  return locateValue(combined, searchText, anchorText).idx !== -1;
}

// Renders one page of a PDF to canvas and, when a searchText is given, finds
// it among that page's text items and returns a pixel rect (in viewport
// space) to draw a highlight over — this is real text search against the
// actual document content, not a guess.
async function findHighlightRect(
  pdfjsLib: typeof import("pdfjs-dist"),
  page: import("pdfjs-dist").PDFPageProxy,
  viewport: import("pdfjs-dist").PageViewport,
  searchText: string,
  anchorText?: string
): Promise<Rect | null> {
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
  // Anchored lookup: highlight the value that follows this metric's own label, not
  // simply the first matching number on the page.
  const { idx, len } = locateValue(combined, searchText, anchorText);
  if (idx === -1 || !normalizedSearch) return null;

  const matchEnd = idx + len;
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
  const renderTaskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);

  const [status, setStatus] = useState<"loading" | "searching" | "ready" | "error">("loading");
  const [currentPage, setCurrentPage] = useState(target.page ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [searchMissed, setSearchMissed] = useState(false);
  // Which page we have actually finished searching. The neighbour-page fallback must
  // wait for this: rendering the cited page is far slower than reading a neighbour's
  // text layer, so an ungated fallback wins the race and navigates away from a page
  // whose highlight was about to resolve correctly.
  const [probedPage, setProbedPage] = useState<number | null>(null);

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
            if (await pageContainsText(page, target.searchText, target.anchorText)) {
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

      if (target.searchText) {
        const found = await findHighlightRect(pdfjsLib, page, viewport, target.searchText, target.anchorText);
        if (cancelled) return;
        setRect(found);
        setProbedPage(currentPage);
        setSearchMissed(!found);
      } else {
        setRect(null);
        setProbedPage(currentPage);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [status, currentPage, target.searchText, target.anchorText]);

  // If the recorded page genuinely didn't contain the figure, try its immediate
  // neighbours once — reports are occasionally off-by-one against the page number
  // recorded during research. Two guards keep this honest: it only runs once the
  // cited page has actually been searched (probedPage), and only for refs carrying a
  // label anchor, so a neighbour can only win by matching label AND value. Without
  // both, this fallback silently relocates correct citations onto lookalike numbers.
  useEffect(() => {
    if (
      !rect &&
      status === "ready" &&
      target.page &&
      target.searchText &&
      target.anchorText &&
      currentPage === target.page &&
      probedPage === target.page &&
      numPages
    ) {
      let cancelled = false;
      (async () => {
        const pdfjsLib = await import("pdfjs-dist");
        const doc = pdfRef.current;
        if (!doc) return;
        for (const candidate of [target.page! + 1, target.page! - 1]) {
          if (candidate < 1 || candidate > numPages) continue;
          const page = await doc.getPage(candidate);
          const viewport = page.getViewport({ scale: 1.6 });
          const found = await findHighlightRect(pdfjsLib, page, viewport, target.searchText!, target.anchorText);
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
  }, [rect, status, probedPage]);

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
