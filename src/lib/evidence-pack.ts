"use client";

// Builds an audit evidence pack: for every figure in scope, the document it came from,
// the page it appears on, a screenshot of that page with the exact figure ringed, the
// text actually extracted around it, and a SHA-256 of the document bytes examined.
//
// Two rules shape everything here.
//
// 1. It re-verifies. Nothing is copied from a stored flag: each figure is re-located in
//    the source at export time, through the same resolver the on-screen viewer uses, so
//    the pack reports what is true now rather than what was true when the data was
//    gathered.
// 2. It never quietly drops a figure. Every item in scope produces exactly one record —
//    the count is asserted — and anything that could not be evidenced is carried into
//    the pack as an exception with the reason, printed before the evidence, not after.

import { jsPDF } from "jspdf";
import { rectFor, resolveRef, type MatchMethod, type RefLocation } from "@/lib/source-match";

export interface EvidenceItem {
  id: string;
  entity: string;
  period: string;
  metric: string;
  value: string;
  documentName: string;
  documentUrl: string;
  page?: number;
  searchText?: string;
  anchorText?: string;
  /** A quote captured when the figure was sourced (MRI Scan findings carry one). */
  quote?: string;
  retrievedAt?: string;
  /** Caveat or derivation note shown alongside the figure in the dashboard. */
  note?: string;
  provenance?: "first_party" | "third_party" | "unknown";
  verification?: string;
  xbrl?: { cik?: string; taxonomy?: string; tag?: string; periodEnd?: string };
  /** False when the source is a web page rather than a PDF — no page image is possible. */
  isPdf?: boolean;
  origin: "dataset" | "mri";
}

/** What kind of claim the figure is — never a uniform green tick across the population. */
export type Basis = "QUOTED" | "DERIVED" | "XBRL" | "UNVERIFIED";

export type ExceptionClass =
  | "NO_SOURCE_REF"
  | "NO_SEARCH_TEXT"
  | "NO_ANCHOR"
  | "AMBIGUOUS"
  | "PAGE_DRIFT"
  | "VALUE_NOT_FOUND"
  | "PAGE_OUT_OF_RANGE"
  | "DOC_UNREACHABLE"
  | "NOT_A_PDF"
  | "NO_TEXT_LAYER"
  | "RENDER_BLANK"
  | "DERIVED"
  | "THIRD_PARTY"
  | "IMAGE_NOT_CAPTURED"
  | "WEB_PAGE_SOURCE"
  | "DEADLINE_REACHED";

export const EXCEPTION_LABEL: Record<ExceptionClass, string> = {
  NO_SOURCE_REF: "No source reference recorded — the figure links only to the document",
  NO_SEARCH_TEXT: "A page is recorded but not the figure text, so nothing can be pinpointed",
  NO_ANCHOR: "No label anchor recorded — matched on the figure alone",
  AMBIGUOUS: "The figure appears more than once on the page and no label anchor pinned it",
  PAGE_DRIFT: "Found on a neighbouring page, not the page recorded",
  VALUE_NOT_FOUND: "The figure could not be re-located in the source at export time",
  PAGE_OUT_OF_RANGE: "The recorded page does not exist in the document",
  DOC_UNREACHABLE: "The source document could not be retrieved",
  NOT_A_PDF: "The URL did not return a PDF",
  NO_TEXT_LAYER: "The page is an image scan with no extractable text",
  RENDER_BLANK: "The page rendered blank and was not embedded",
  DERIVED: "Computed by this dashboard from disclosed inputs — not a figure the issuer published",
  THIRD_PARTY: "Sourced from someone other than the issuer",
  IMAGE_NOT_CAPTURED: "Screenshot not captured — the pack's image limit was reached",
  WEB_PAGE_SOURCE:
    "Source is a web page, not a PDF — the figure was confirmed in the page when it was scanned, but a page cannot be re-rendered here, so the evidence is the quote and the URL",
  DEADLINE_REACHED: "Not re-verified — the export's time budget was exhausted",
};

export interface EvidenceRecord extends EvidenceItem {
  basis: Basis;
  exceptions: ExceptionClass[];
  matchMethod: MatchMethod;
  pageCited?: number;
  pageResolved?: number;
  occurrencesOnPage?: number;
  snippet?: string;
  detail?: string;
  pageImage?: string;
  cropImage?: string;
  pageLandscape?: boolean;
  docSha256?: string;
  docBytes?: number;
  docPages?: number;
  fetchedAt?: string;
  reverifiedAt?: string;
}

export interface SourceDocument {
  url: string;
  name: string;
  sha256?: string;
  bytes?: number;
  pages?: number;
  fetchedAt?: string;
  error?: string;
  figureCount: number;
}

export interface EvidencePackRequest {
  title: string;
  subtitle: string;
  preparedBy: string;
  scopeLabel: string;
  items: EvidenceItem[];
  /** Cap on page screenshots. Anything beyond is reported, never silently dropped. */
  maxScreenshots: number;
  /** Wall-clock budget for fetching and re-verifying, in ms. */
  budgetMs: number;
  /** Skip document fetching entirely — register and log only, marked as not re-verified. */
  registerOnly?: boolean;
}

export interface EvidencePack {
  pdf: Blob;
  csv: Blob;
  json: Blob;
  records: EvidenceRecord[];
  documents: SourceDocument[];
  packId: string;
}

const RBC_BLUE = "#0051A5";
const INK = "#12203A";
const BODY = "#33405A";
const MUTED = "#5A6B85";
const RULE = "#DCE3ED";
const PANEL = "#F4F7FB";
const RED = "#9A3412";
const GREEN = "#1F6F4A";

// jsPDF's built-in Helvetica is WinAnsi-encoded: em dashes, arrows and ellipses render
// as garbage. Every string printed into the PDF goes through this. The CSV and JSON
// carry the exact original characters — that difference is stated on the Method page.
function ascii(s: string): string {
  return s
    .replace(/[—–−]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≈/g, "~")
    .replace(/ /g, " ");
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  // crypto.subtle exists only in a secure context; over plain http it is undefined.
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

async function shortHash(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hex = await sha256Hex(enc.buffer as ArrayBuffer);
  return (hex ?? Math.abs(input.length * 2654435761).toString(16)).slice(0, 12).toUpperCase();
}

/** True when a canvas came back essentially uniform — browsers do this silently under
 *  memory pressure, and a blank exhibit under a green header is worse than none. */
function looksBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(Math.min(w, h) / 14));
    let first: number | null = null;
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const key = (d[0] << 16) | (d[1] << 8) | d[2];
        if (first === null) first = key;
        else if (key !== first) return false;
      }
    }
    return true;
  } catch {
    return false; // a tainted or unreadable canvas is not evidence of blankness
  }
}

/** A figure the dashboard computes rather than quotes. */
function isDerived(item: EvidenceItem): boolean {
  const n = (item.note ?? "").toLowerCase();
  return /computed|derived|calculated|= *\(|divided by/.test(n);
}

interface CaptureResult {
  pageImage?: string;
  cropImage?: string;
  landscape?: boolean;
  blank?: boolean;
}

async function capturePage(
  doc: import("pdfjs-dist").PDFDocumentProxy,
  pageNumber: number,
  location: RefLocation,
  canvas: HTMLCanvasElement
): Promise<CaptureResult> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1.6 });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return {};
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    if (looksBlank(ctx, canvas.width, canvas.height)) return { blank: true };

    const rect = location.bbox ? rectFor(location.bbox, viewport) : null;
    if (rect) {
      // The same marker the on-screen viewer draws: translucent yellow, amber ring.
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(250, 204, 21, 0.5)";
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.restore();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }

    const pageImage = canvas.toDataURL("image/jpeg", 0.7);

    // The crop is the primary exhibit: a full page shrunk onto a pack page prints an
    // 8pt table row at about 4pt, which is context, not readable evidence.
    let cropImage: string | undefined;
    if (rect) {
      const padX = Math.max(210, rect.width * 2);
      const padY = Math.max(30, rect.height * 1.4);
      const sx = Math.max(0, rect.left - padX);
      const sy = Math.max(0, rect.top - padY);
      const sw = Math.min(canvas.width - sx, rect.width + padX * 2);
      const sh = Math.min(canvas.height - sy, rect.height + padY * 2);
      const crop = document.createElement("canvas");
      const zoom = 2;
      crop.width = Math.floor(sw * zoom);
      crop.height = Math.floor(sh * zoom);
      const cctx = crop.getContext("2d");
      if (cctx) {
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(0, 0, crop.width, crop.height);
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
        cropImage = crop.toDataURL("image/jpeg", 0.88);
      }
      crop.width = 0;
      crop.height = 0;
    }

    return { pageImage, cropImage, landscape: viewport.width > viewport.height };
  } finally {
    page.cleanup();
  }
}

/** What an export will cost, computed without fetching anything. */
export function planEvidence(items: EvidenceItem[]): { figures: number; documents: number } {
  const urls = new Set(items.filter((i) => i.documentUrl).map((i) => i.documentUrl));
  return { figures: items.length, documents: urls.size };
}

export async function collectEvidence(
  req: EvidencePackRequest,
  onProgress?: (done: number, total: number, label: string) => void
): Promise<{ records: EvidenceRecord[]; documents: SourceDocument[] }> {
  const total = req.items.length;
  const records: EvidenceRecord[] = [];
  const documents: SourceDocument[] = [];
  let done = 0;

  const baseRecord = (item: EvidenceItem): EvidenceRecord => {
    const exceptions: ExceptionClass[] = [];
    if (isDerived(item)) exceptions.push("DERIVED");
    if (item.provenance === "third_party") exceptions.push("THIRD_PARTY");
    if (!item.page && !item.searchText) exceptions.push("NO_SOURCE_REF");
    else if (!item.searchText) exceptions.push("NO_SEARCH_TEXT");
    else if (!item.anchorText) exceptions.push("NO_ANCHOR");
    return {
      ...item,
      basis: item.xbrl?.tag ? "XBRL" : isDerived(item) ? "DERIVED" : "UNVERIFIED",
      exceptions,
      matchMethod: "none",
      pageCited: item.page,
    };
  };

  if (req.registerOnly) {
    for (const item of req.items) {
      const r = baseRecord(item);
      r.exceptions.push("DEADLINE_REACHED");
      r.detail = "Register-only export: source documents were not fetched, so no figure was re-verified.";
      records.push(r);
      onProgress?.(++done, total, item.metric);
    }
    return { records, documents };
  }

  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  // One worker for the whole run. A worker per document means one 1.25 MB worker script
  // per document, which is what makes a 40-document export fall over.
  const worker = new pdfjsLib.PDFWorker();
  // One canvas, resized per page and released at the end, for the same reason.
  const canvas = document.createElement("canvas");

  const deadline = Date.now() + req.budgetMs;
  let shots = 0;

  const byUrl = new Map<string, EvidenceItem[]>();
  const noDoc: EvidenceItem[] = [];
  for (const item of req.items) {
    if (!item.documentUrl || (item.xbrl?.tag && !item.page) || item.isPdf === false) {
      noDoc.push(item);
      continue;
    }
    const list = byUrl.get(item.documentUrl) ?? [];
    list.push(item);
    byUrl.set(item.documentUrl, list);
  }

  for (const item of noDoc) {
    const r = baseRecord(item);
    if (item.xbrl?.tag) {
      r.basis = "XBRL";
      r.detail = `Reported under XBRL tag ${item.xbrl.tag} (${item.xbrl.taxonomy ?? "taxonomy not recorded"}) for CIK ${
        item.xbrl.cik ?? "unknown"
      }${item.xbrl.periodEnd ? `, period ending ${item.xbrl.periodEnd}` : ""}. Re-checkable against the filed data through the SEC companyfacts API.`;
    } else if (item.isPdf === false) {
      // A web page can't be rendered or text-searched by the PDF pipeline. The quote
      // captured at scan time is the evidence, and the pack says so rather than
      // reporting a fetch failure it never attempted.
      r.basis = "QUOTED";
      r.exceptions.push("WEB_PAGE_SOURCE");
      r.detail = `Evidenced by the quote captured when this figure was sourced${
        item.verification ? ` (${item.verification})` : ""
      }. Open the URL and search for the quoted text to re-check it.`;
    } else {
      r.detail = "No source document is recorded for this figure.";
      if (!r.exceptions.includes("NO_SOURCE_REF")) r.exceptions.push("NO_SOURCE_REF");
    }
    records.push(r);
    onProgress?.(++done, total, `${item.entity} · ${item.metric}`);
  }

  try {
    for (const [url, items] of byUrl) {
      const docMeta: SourceDocument = { url, name: items[0]?.documentName ?? url, figureCount: items.length };
      let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
      let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;

      if (Date.now() > deadline) {
        for (const item of items) {
          const r = baseRecord(item);
          r.exceptions.push("DEADLINE_REACHED");
          r.detail = "The export's time budget was exhausted before this document was reached, so this figure was not re-verified.";
          records.push(r);
          onProgress?.(++done, total, `${item.entity} · ${item.metric}`);
        }
        documents.push({ ...docMeta, error: "not attempted (time budget exhausted)" });
        continue;
      }

      try {
        onProgress?.(done, total, `Retrieving ${docMeta.name}`);
        const res = await fetch(`/api/pdf-proxy?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`the source responded ${res.status}`);
        const buf = await res.arrayBuffer();
        // Content-Length is missing on several banks' documents (chunked), so size
        // always comes from the bytes we actually received.
        docMeta.bytes = buf.byteLength;
        docMeta.sha256 = await sha256Hex(buf);
        docMeta.fetchedAt = new Date().toISOString();

        // A 404 page served as text/html for a .pdf URL is the classic silent failure.
        const magic = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
        if (magic !== "%PDF-") throw new Error("the response was not a PDF");

        // pdf.js detaches the buffer it is handed, so give it a copy and keep ours.
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), worker });
        doc = await loadingTask.promise;
        docMeta.pages = doc.numPages;
      } catch (err) {
        const why = err instanceof Error ? err.message : "unavailable";
        docMeta.error = why;
        for (const item of items) {
          const r = baseRecord(item);
          r.exceptions.push(why.includes("not a PDF") ? "NOT_A_PDF" : "DOC_UNREACHABLE");
          r.detail = `The source could not be retrieved when this pack was built (${why}).`;
          r.fetchedAt = docMeta.fetchedAt;
          records.push(r);
          onProgress?.(++done, total, `${item.entity} · ${item.metric}`);
        }
        documents.push(docMeta);
        continue;
      }

      for (const item of items) {
        const r = baseRecord(item);
        r.docSha256 = docMeta.sha256;
        r.docBytes = docMeta.bytes;
        r.docPages = docMeta.pages;
        r.fetchedAt = docMeta.fetchedAt;
        r.reverifiedAt = new Date().toISOString();

        try {
          const loc = await resolveRef(pdfjsLib, doc, { page: item.page, searchText: item.searchText, anchorText: item.anchorText });
          r.matchMethod = loc.matchMethod;
          r.pageResolved = loc.pageResolved;
          r.occurrencesOnPage = loc.occurrencesOnPage;
          r.snippet = loc.snippet;
          r.detail = loc.detail;

          if (loc.ambiguous) r.exceptions.push("AMBIGUOUS");
          if (loc.matchMethod === "anchored_neighbour_page") r.exceptions.push("PAGE_DRIFT");
          if (loc.status === "page_out_of_range") r.exceptions.push("PAGE_OUT_OF_RANGE");
          if (loc.status === "no_text_layer") r.exceptions.push("NO_TEXT_LAYER");
          if (loc.status === "value_not_found") r.exceptions.push("VALUE_NOT_FOUND");

          if (loc.status === "located") {
            r.basis = r.basis === "DERIVED" ? "DERIVED" : "QUOTED";
            if (shots >= req.maxScreenshots) {
              r.exceptions.push("IMAGE_NOT_CAPTURED");
              r.detail = `Located on page ${loc.pageResolved}. Screenshot omitted: this pack's limit of ${req.maxScreenshots} page images was reached.`;
            } else {
              const shot = await capturePage(doc, loc.pageResolved!, loc, canvas);
              if (shot.blank) {
                r.exceptions.push("RENDER_BLANK");
                r.detail = "The page rendered blank, so no image is included. The figure was still located in the page text.";
              } else {
                r.pageImage = shot.pageImage;
                r.cropImage = shot.cropImage;
                r.pageLandscape = shot.landscape;
                shots++;
              }
            }
          }
        } catch (err) {
          // A catch that does not write a row is how an export goes silently incomplete.
          r.exceptions.push("VALUE_NOT_FOUND");
          r.detail = `Could not be re-verified (${err instanceof Error ? err.message : "unknown error"}).`;
        }

        records.push(r);
        onProgress?.(++done, total, `${item.entity} · ${item.metric}`);
      }

      documents.push(docMeta);
      // Release the document's pages and transport before opening the next one.
      await loadingTask?.destroy();
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    worker.destroy();
  }

  const order = new Map(req.items.map((it, i) => [it.id, i]));
  records.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { records, documents };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};

function buildCsv(records: EvidenceRecord[]): string {
  const cols = [
    "figure_id", "entity", "period", "metric", "value", "basis", "exceptions", "origin",
    "match_method", "page_cited", "page_resolved", "occurrences_on_page",
    "document_name", "document_url", "figure_as_printed", "label_anchor",
    "extracted_context", "quote", "provenance", "verification", "note", "detail",
    "data_retrieved_at", "reverified_at", "document_sha256", "document_bytes",
    "document_pages", "document_fetched_at", "xbrl_tag", "xbrl_cik",
    "reviewer_initials", "reviewer_conclusion",
  ];
  const rows = records.map((r) =>
    [
      r.id, r.entity, r.period, r.metric, r.value, r.basis, r.exceptions.join("|"), r.origin,
      r.matchMethod, r.pageCited ?? "", r.pageResolved ?? "", r.occurrencesOnPage ?? "",
      r.documentName, r.documentUrl, r.searchText ?? "", r.anchorText ?? "",
      r.snippet ?? "", r.quote ?? "", r.provenance ?? "", r.verification ?? "", r.note ?? "", r.detail ?? "",
      r.retrievedAt ?? "", r.reverifiedAt ?? "", r.docSha256 ?? "", r.docBytes ?? "",
      r.docPages ?? "", r.fetchedAt ?? "", r.xbrl?.tag ?? "", r.xbrl?.cik ?? "",
      "", "",
    ].map(csvCell).join(",")
  );
  // BOM so Excel doesn't mangle accented issuer names.
  return "﻿" + [cols.join(","), ...rows].join("\r\n");
}

function buildPdfDoc(
  req: EvidencePackRequest,
  records: EvidenceRecord[],
  documents: SourceDocument[],
  packId: string
): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 44;
  const generatedAt = new Date();
  const stamp = generatedAt.toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" });

  const wrap = (text: string, width: number) => doc.splitTextToSize(ascii(text), width) as string[];
  const say = (text: string, x: number, y: number, opts?: Parameters<jsPDF["text"]>[3]) => doc.text(ascii(text), x, y, opts);

  const page = (title: string, sub?: string): number => {
    doc.addPage();
    doc.setFillColor(RBC_BLUE).rect(0, 0, W, 3.5, "F");
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(INK);
    say(title, M, 46);
    if (sub) {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(MUTED);
      say(sub, M, 60);
    }
    doc.setDrawColor(RULE).setLineWidth(0.7).line(M, 68, W - M, 68);
    doc.setFont("helvetica", "normal");
    return 88;
  };

  const bullets = (lines: string[], y: number, width: number, size = 8.5): number => {
    doc.setFontSize(size);
    for (const line of lines) {
      const w = wrap(line, width - 14);
      doc.setFillColor(RBC_BLUE).circle(M + 3, y - 3, 1.7, "F");
      doc.setTextColor(BODY).text(w, M + 13, y);
      y += w.length * (size + 2.5) + 6;
    }
    return y;
  };

  const located = records.filter((r) => r.pageResolved && r.matchMethod !== "none");
  const withImages = records.filter((r) => r.pageImage);
  const exceptions = records.filter((r) => r.exceptions.length);
  const byClass = new Map<ExceptionClass, EvidenceRecord[]>();
  for (const r of records) for (const e of r.exceptions) byClass.set(e, [...(byClass.get(e) ?? []), r]);

  // ---------------------------------------------------------------- cover
  doc.setFillColor("#0C1424").rect(0, 0, W, H, "F");
  doc.setFillColor(RBC_BLUE).rect(0, 0, 8, H, "F");
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#4DA3FF");
  say("RBC TREASURY INTELLIGENCE  ·  EVIDENCE PACK", M, 110);
  doc.setFontSize(24).setTextColor("#FFFFFF").text(wrap(req.title, W - M * 2), M, 148);
  doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor("#A8BBD6").text(wrap(req.subtitle, W - M * 2), M, 176);
  doc.setFillColor(RBC_BLUE).rect(M, 194, 80, 2, "F");

  let cy = 224;
  const coverRow = (k: string, v: string) => {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#8FA3C0");
    say(k, M, cy);
    const lines = wrap(v, W - M * 2 - 140);
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor("#FFFFFF").text(lines, M + 140, cy);
    cy += Math.max(14, lines.length * 11 + 3);
  };
  coverRow("Pack ID", packId);
  coverRow("Scope", req.scopeLabel);
  coverRow("Prepared by", req.preparedBy);
  coverRow("Generated", `${stamp} — the exporting browser's local clock, unattested`);
  coverRow("Source documents", `${documents.length} examined`);

  // Counts that foot as printed arithmetic.
  cy += 10;
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#FFFFFF");
  say("Coverage", M, cy);
  cy += 14;
  const anchored = located.filter((r) => r.matchMethod.startsWith("anchored")).length;
  const unanchored = located.filter((r) => r.matchMethod.startsWith("unanchored")).length;
  const notLocated = records.length - located.length;
  const rows: [string, number][] = [
    ["Re-located under their own label", anchored],
    ["Re-located on the figure alone (no label anchor)", unanchored],
    ["Not re-located", notLocated],
  ];
  doc.setFont("helvetica", "normal").setFontSize(8);
  for (const [k, v] of rows) {
    doc.setTextColor("#A8BBD6");
    say(k, M + 10, cy);
    doc.setTextColor("#FFFFFF");
    say(String(v), M + 320, cy, { align: "right" });
    cy += 12;
  }
  doc.setDrawColor("#2A3A55").line(M + 10, cy - 6, M + 320, cy - 6);
  doc.setFont("helvetica", "bold").setTextColor("#FFFFFF");
  say("Figures in scope", M + 10, cy + 4);
  say(String(records.length), M + 320, cy + 4, { align: "right" });
  cy += 14;
  const foots = anchored + unanchored + notLocated === records.length && records.length === req.items.length;
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(foots ? "#7FD1A6" : "#FF9B7A");
  say(
    foots
      ? `Counts foot: one record was produced for each of the ${req.items.length} figures selected.`
      : `WARNING: ${req.items.length} figures were selected but ${records.length} records were produced. Treat this pack as incomplete.`,
    M + 10,
    cy + 2
  );

  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#FFFFFF");
  say("What this pack does and does not assert", M, H - 168);
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor("#8FA3C0");
  doc.text(
    wrap(
      '1. Machine-generated and unaudited. Prepared for internal review; it is not an assurance opinion.  ' +
        '2. "Re-located" means the printed characters were found again on the cited page, under the cited label, at the moment of export — nothing more.  ' +
        "3. It does not assert that a metric is defined identically across the six institutions. Averaging conventions and disclosure granularity differ, particularly for LCR and the deposit splits.  " +
        "4. Figures marked DERIVED are this dashboard's arithmetic over disclosed inputs, not a number the issuer published. The page image evidences an input, not the derived result.",
      W - M * 2
    ),
    M,
    H - 152
  );

  // ------------------------------------------------------- exceptions first
  {
    let y = page("Exceptions", exceptions.length ? `${exceptions.length} of ${records.length} figures carry at least one qualification` : "None");
    doc.setFontSize(8).setTextColor(BODY);
    doc.text(
      wrap(
        "Read this before the evidence. Every class below is derived automatically from what happened during this export, so it cannot disagree with the register that follows.",
        W - M * 2
      ),
      M,
      y
    );
    y += 26;

    if (!exceptions.length) {
      doc.setFontSize(9).setTextColor(GREEN);
      say("No exceptions: every figure in scope was re-located under its own label, with no qualifications.", M, y);
    } else {
      doc.setFillColor(RBC_BLUE).rect(M, y - 11, W - M * 2, 18, "F");
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#FFFFFF");
      say("Class", M + 8, y + 1);
      say("Figures", W - M - 8, y + 1, { align: "right" });
      y += 24;
      doc.setFont("helvetica", "normal");
      let i = 0;
      for (const [cls, list] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
        if (y > H - 70) y = page("Exceptions (cont.)");
        if (i++ % 2 === 1) doc.setFillColor(PANEL).rect(M, y - 10, W - M * 2, 16, "F");
        doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(RED);
        say(cls, M + 8, y);
        doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(BODY);
        const label = wrap(EXCEPTION_LABEL[cls], W - M * 2 - 190)[0] ?? "";
        say(label, M + 130, y);
        doc.setTextColor(INK);
        say(String(list.length), W - M - 8, y, { align: "right" });
        y += 18;
      }

      y += 12;
      if (y < H - 120) {
        doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
        say("Figures that could not be re-located", M, y);
        y += 14;
        const hard = records.filter((r) =>
          r.exceptions.some((e) => ["VALUE_NOT_FOUND", "DOC_UNREACHABLE", "NOT_A_PDF", "PAGE_OUT_OF_RANGE", "NO_TEXT_LAYER", "RENDER_BLANK"].includes(e))
        );
        doc.setFont("helvetica", "normal").setFontSize(7.5);
        if (!hard.length) {
          doc.setTextColor(GREEN);
          say("None — every figure was found in its source.", M, y);
        } else {
          for (const r of hard) {
            if (y > H - 50) y = page("Figures that could not be re-located (cont.)");
            doc.setTextColor(INK);
            say(`${r.entity} · ${r.period} · ${r.metric} = ${r.value}`, M, y);
            doc.setTextColor(RED);
            say(r.exceptions.filter((e) => e !== "DERIVED" && e !== "NO_ANCHOR").join(", "), W - M, y, { align: "right" });
            y += 10;
            if (r.detail) {
              doc.setTextColor(MUTED);
              doc.text(wrap(r.detail, W - M * 2).slice(0, 2), M + 10, y);
              y += 11;
            }
            y += 4;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ method
  {
    let y = page("Method and how to reproduce", "What was done, with the constants that did it");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
    say("By hand", M, y);
    y += 14;
    y = bullets(
      [
        "Open the document URL printed on the figure's evidence page. Go to the page number shown. Find the label anchor quoted on that page, then read the figure immediately to its right or below it. Both strings are printed exactly as they were searched for.",
        "Compare the SHA-256 on the source-receipts page with a hash of the file you downloaded. If they differ, the institution has republished the document since this pack was built.",
      ],
      y,
      W - M * 2
    );

    y += 4;
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
    say("By machine", M, y);
    y += 14;
    y = bullets(
      [
        "Each document was fetched fresh at export time and its first five bytes checked for the PDF signature, so an HTML error page served in place of a PDF is caught rather than counted as evidence.",
        "Text is taken from the PDF text layer, lower-cased with whitespace collapsed. A page whose text layer is essentially empty is reported as an image scan, not as a failed match.",
        "The figure must appear within 240 normalised characters after its label anchor, and must sit on whole-number boundaries — which is why 4.2 does not match inside c$4.233 billion or 184.7 million.",
        "Where a citation records no label anchor, the figure alone is matched and the figure is flagged NO_ANCHOR; if it appears more than once on the page it is also flagged AMBIGUOUS.",
        "If the figure is not on the cited page, the two neighbouring pages are tried, but only for citations that carry a label anchor. A page found this way is flagged PAGE_DRIFT.",
        "Where no page was recorded, the first 150 pages are scanned. The same limit applies in the on-screen viewer, so this pack cannot evidence a figure the viewer is unable to show.",
        "The highlight is stored as a fraction of the page and scaled to whatever size it is drawn at, so the ring in this pack covers the same characters as the ring on screen. Colours are drawn by this tool; they are not part of the original document.",
      ],
      y,
      W - M * 2
    );

    y += 4;
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
    say("Two honest notes", M, y);
    y += 14;
    bullets(
      [
        `Reproducibility: the Pack ID is deterministic for a given selection, and row order is stable. Timestamps, hashes and extracted snippets are observations of a live fetch, so two exports will not be byte-identical — that is expected, not a defect.`,
        "Character set: this PDF is written in a Latin-1 font, so dashes, arrows and ellipses in quoted text are transliterated to plain ASCII. The CSV and JSON alongside it carry the exact original characters.",
      ],
      y,
      W - M * 2
    );
  }

  // --------------------------------------------------------- register
  {
    let y = page("Evidence register", `All ${records.length} figures, in the order shown in the dashboard`);
    const cols = [
      { k: "Institution", w: 92 },
      { k: "Period", w: 38 },
      { k: "Metric", w: 150 },
      { k: "Value", w: 42 },
      { k: "Basis", w: 40 },
      { k: "Page", w: 26 },
      { k: "Qualifications", w: 0 },
    ];
    const lastW = W - M * 2 - cols.reduce((s, c) => s + c.w, 0) - 12;
    const drawHead = () => {
      doc.setFillColor(RBC_BLUE).rect(M, y - 11, W - M * 2, 18, "F");
      doc.setFont("helvetica", "bold").setFontSize(7).setTextColor("#FFFFFF");
      let x = M + 6;
      for (const c of cols) {
        say(c.k, x, y + 1);
        x += c.w || lastW;
      }
      y += 22;
      doc.setFont("helvetica", "normal");
    };
    drawHead();
    const MAX_ROWS = 320;
    records.slice(0, MAX_ROWS).forEach((r, i) => {
      if (y > H - 56) {
        y = page("Evidence register (cont.)");
        drawHead();
      }
      if (i % 2 === 1) doc.setFillColor(PANEL).rect(M, y - 9, W - M * 2, 15, "F");
      const quals = r.exceptions.filter((e) => e !== "DERIVED").join(", ");
      const cells = [r.entity, r.period, r.metric, r.value, r.basis, r.pageResolved ? String(r.pageResolved) : "-", quals || "none"];
      let x = M + 6;
      cells.forEach((cell, ci) => {
        const width = cols[ci].w || lastW;
        doc.setFontSize(7).setTextColor(ci === 4 ? (r.basis === "QUOTED" ? GREEN : RED) : ci === 6 && quals ? RED : BODY);
        say(wrap(String(cell), width - 6)[0] ?? "", x, y);
        x += width;
      });
      y += 16;
    });
    if (records.length > MAX_ROWS) {
      y += 8;
      doc.setFontSize(8).setTextColor(RED);
      say(`Showing the first ${MAX_ROWS} of ${records.length} figures. The complete register is in the CSV and JSON alongside this pack.`, M, y);
    }
  }

  // ---------------------------------------------------- evidence pages
  if (withImages.length) {
    const y = page("Evidence", `${withImages.length} figure${withImages.length === 1 ? "" : "s"} shown at source${
      withImages.length < located.length ? ` — ${located.length - withImages.length} more were located but not imaged (see Exceptions)` : ""
    }`);
    doc.setFontSize(8).setTextColor(BODY);
    doc.text(
      wrap(
        "Each page below shows the figure enlarged from its source, then the whole page it sits on for context. The yellow ring is drawn at the coordinates the text search returned.",
        W - M * 2
      ),
      M,
      y
    );
  }

  for (const r of withImages) {
    let y = page(`${r.entity} — ${r.metric}`, `${r.period} · shown in the dashboard as ${r.value}`);

    const chip = r.basis === "QUOTED" ? GREEN : RED;
    doc.setFillColor(chip).roundedRect(W - M - 62, 34, 62, 15, 3, 3, "F");
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor("#FFFFFF");
    say(r.basis, W - M - 31, 44, { align: "center" });
    doc.setFont("helvetica", "normal");

    doc.setFillColor(PANEL).roundedRect(M, y - 12, W - M * 2, 72, 4, 4, "F");
    doc.setDrawColor(RULE).roundedRect(M, y - 12, W - M * 2, 72, 4, 4, "S");
    const half = (W - M * 2) / 2;
    const meta = (k: string, v: string, col: 0 | 1, row: number) => {
      const x = M + 10 + col * half;
      const yy = y + row * 15;
      doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(MUTED);
      say(k.toUpperCase(), x, yy);
      doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(INK);
      say(wrap(v, half - 92)[0] ?? "", x + 84, yy);
    };
    meta("Document", r.documentName, 0, 0);
    meta("Page", r.pageResolved ? `${r.pageResolved} of ${r.docPages ?? "?"}${r.pageCited && r.pageCited !== r.pageResolved ? ` (cited ${r.pageCited})` : ""}` : "-", 1, 0);
    meta("Figure as printed", r.searchText ?? "-", 0, 1);
    meta("Label anchor", r.anchorText ?? "none recorded", 1, 1);
    meta("Match method", r.matchMethod, 0, 2);
    meta("Provenance", r.provenance === "first_party" ? "Issuer's own document" : r.provenance === "third_party" ? "Third-party source" : "-", 1, 2);
    meta("Re-verified", r.reverifiedAt?.slice(0, 19).replace("T", " ") + "Z", 0, 3);
    meta("Document SHA-256", r.docSha256 ? `${r.docSha256.slice(0, 32)}...` : "not available", 1, 3);
    y += 76;

    if (r.exceptions.length) {
      doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(RED);
      const w = wrap(`Qualifications: ${r.exceptions.map((e) => EXCEPTION_LABEL[e]).join(". ")}.`, W - M * 2);
      doc.text(w.slice(0, 3), M, y);
      y += Math.min(w.length, 3) * 9 + 6;
      doc.setFont("helvetica", "normal");
    }
    if (r.note) {
      doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(MUTED);
      const w = wrap(`Dashboard note: ${r.note}`, W - M * 2);
      doc.text(w.slice(0, 3), M, y);
      y += Math.min(w.length, 3) * 9 + 6;
      doc.setFont("helvetica", "normal");
    }

    // Primary exhibit: the figure, enlarged.
    if (r.cropImage) {
      const cw = W - M * 2;
      const ch = 96;
      try {
        doc.addImage(r.cropImage, "JPEG", M, y, cw, ch, undefined, "FAST");
        doc.setDrawColor(RULE).rect(M, y, cw, ch, "S");
      } catch {
        /* an image that fails to embed must not take the pack down */
      }
      doc.setFontSize(6.5).setTextColor(MUTED);
      say("The cited figure, enlarged from the page below", M, y + ch + 9);
      y += ch + 18;
    }

    if (r.snippet) {
      doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(BODY);
      const w = wrap(`Text extracted around the figure: "${r.snippet}"`, W - M * 2);
      doc.text(w.slice(0, 3), M, y);
      y += Math.min(w.length, 3) * 8.5 + 8;
      doc.setFont("helvetica", "normal");
    }

    // Secondary: the whole page, for context.
    const availH = H - y - 40;
    const availW = W - M * 2;
    const ratio = r.pageLandscape ? 595 / 842 : 842 / 595;
    let iw = availW;
    let ih = iw * ratio;
    if (ih > availH) {
      ih = availH;
      iw = ih / ratio;
    }
    try {
      const ix = M + (availW - iw) / 2;
      doc.addImage(r.pageImage!, "JPEG", ix, y, iw, ih, undefined, "FAST");
      doc.setDrawColor(RULE).rect(ix, y, iw, ih, "S");
    } catch {
      doc.setFontSize(8).setTextColor(RED);
      say("The page image could not be embedded in this pack.", M, y + 12);
    }
    doc.setFontSize(6.5).setTextColor(MUTED);
    say(wrap(r.documentUrl, W - M * 2)[0] ?? "", M, H - 30);
  }

  // -------------------------------------------------------- source receipts
  {
    let y = page("Source receipts", `${documents.length} document${documents.length === 1 ? "" : "s"} retrieved for this pack`);
    doc.setFontSize(8).setTextColor(BODY);
    doc.text(wrap("The exact bytes examined, so a reviewer can confirm they are looking at the same file version.", W - M * 2), M, y);
    y += 20;
    for (const d of documents) {
      if (y > H - 76) y = page("Source receipts (cont.)");
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(INK);
      say(wrap(d.name, W - M * 2 - 60)[0] ?? "", M, y);
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(MUTED);
      say(`${d.figureCount} figure${d.figureCount === 1 ? "" : "s"}`, W - M, y, { align: "right" });
      y += 10;
      doc.setFontSize(6.5).setTextColor(BODY).text(wrap(d.url, W - M * 2), M, y);
      y += 9;
      doc.setTextColor(d.error ? RED : "#7A8AA3");
      say(
        d.error
          ? `NOT RETRIEVED - ${d.error}`
          : `SHA-256 ${d.sha256 ?? "unavailable (insecure context)"}`,
        M,
        y
      );
      y += 9;
      if (!d.error) {
        doc.setTextColor("#7A8AA3");
        say(`${(d.bytes ?? 0).toLocaleString()} bytes · ${d.pages ?? "?"} pages · retrieved ${d.fetchedAt?.slice(0, 19).replace("T", " ")}Z`, M, y);
        y += 9;
      }
      y += 8;
      doc.setDrawColor(RULE).line(M, y - 8, W - M, y - 8);
    }
  }

  // footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(6.5).setTextColor(MUTED);
    say(`Pack ${packId} · ${req.title} · generated ${stamp}`, M, H - 18);
    say(`${p - 1} / ${totalPages - 1}`, W - M, H - 18, { align: "right" });
  }

  return doc;
}

/** Deterministic for a given selection, so two exports of the same scope share an ID. */
export async function packIdFor(req: Pick<EvidencePackRequest, "scopeLabel" | "items" | "title">): Promise<string> {
  return shortHash(JSON.stringify({ scope: req.scopeLabel, ids: req.items.map((i) => i.id).sort(), title: req.title }));
}

/**
 * The register files. Built and handed over BEFORE the PDF: they are the artefact an
 * auditor actually works in, and if PDF assembly exhausts the tab's memory the reviewer
 * should still be holding the log.
 */
export function buildRegisterFiles(
  req: EvidencePackRequest,
  records: EvidenceRecord[],
  documents: SourceDocument[],
  packId: string
): { csv: Blob; json: Blob } {
  const csv = new Blob([buildCsv(records)], { type: "text/csv;charset=utf-8" });
  const json = new Blob(
    [
      JSON.stringify(
        {
          pack: {
            packId,
            title: req.title,
            subtitle: req.subtitle,
            scope: req.scopeLabel,
            preparedBy: req.preparedBy,
            generatedAt: new Date().toISOString(),
            figuresSelected: req.items.length,
            recordsProduced: records.length,
            countsFoot: records.length === req.items.length,
            screenshotLimit: req.maxScreenshots,
            registerOnly: !!req.registerOnly,
          },
          method: {
            anchorWindowChars: 240,
            maxScanPages: 150,
            wholeNumberBoundaries: true,
            neighbourPageFallback: "only for citations carrying a label anchor",
            renderScale: 1.6,
            volatileFields: ["reverifiedAt", "fetchedAt", "generatedAt", "docSha256", "snippet", "occurrencesOnPage"],
          },
          documents,
          // Images live in the PDF, not here — this file stays diffable and small.
          figures: records.map((r) => {
            const rest: Partial<EvidenceRecord> = { ...r };
            delete rest.pageImage;
            delete rest.cropImage;
            return rest;
          }),
        },
        null,
        2
      ),
    ],
    { type: "application/json" }
  );

  return { csv, json };
}

export function buildPackPdf(
  req: EvidencePackRequest,
  records: EvidenceRecord[],
  documents: SourceDocument[],
  packId: string
): Blob {
  return buildPdfDoc(req, records, documents, packId).output("blob");
}

/** Convenience wrapper — the staged calls above are what the UI uses. */
export async function buildEvidencePack(
  req: EvidencePackRequest,
  onProgress?: (done: number, total: number, label: string) => void
): Promise<EvidencePack> {
  const packId = await packIdFor(req);
  const { records, documents } = await collectEvidence(req, onProgress);
  onProgress?.(req.items.length, req.items.length, "Assembling the pack");
  const { csv, json } = buildRegisterFiles(req, records, documents, packId);
  const pdf = buildPackPdf(req, records, documents, packId);
  return { pdf, csv, json, records, documents, packId };
}
