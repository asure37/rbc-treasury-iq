// Locating a cited figure inside its source PDF.
//
// This is the single implementation behind both the in-app source viewer and the
// exported evidence pack. They MUST agree: an audit pack whose screenshot rings a
// different number than the one the reviewer sees on screen is worse than no pack,
// so neither surface is allowed its own copy of this logic.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    // Typographic quotes render differently in a PDF's text layer than in text we
    // captured elsewhere; folding them makes an anchor match either form.
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Maximum distance (in normalized characters) between a label anchor and its value.
// Wide enough to cross a table row's intervening columns, tight enough that we never
// pair a label with a value from a different section.
export const ANCHOR_WINDOW = 240;

// How deep to scan a document when no page was recorded. One number, imported
// everywhere: if the exporter searched further than the viewer, a pack could evidence
// a figure the viewer is unable to show.
export const MAX_SCAN_PAGES = 150;

// pdf.js emits a leading "$" as its own text item, so "$619,452" in the data becomes
// "$ 619,452" in the extracted stream; some documents likewise split the trailing "%"
// off its number. Try the recorded form first, then those spaced forms, then the bare
// number — most specific to least, so the tightest match wins.
export function valueVariants(searchText: string): string[] {
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

export function indexOfValue(hay: string, needle: string, from = 0): number {
  let i = hay.indexOf(needle, from);
  while (i !== -1) {
    if (isWholeNumberMatch(hay, i, needle.length)) return i;
    i = hay.indexOf(needle, i + 1);
  }
  return -1;
}

/**
 * Index and matched length of the value belonging to `anchorText`.
 *
 * When an anchor is given it is REQUIRED: if this page doesn't carry the metric's own
 * label, we highlight nothing rather than the first number that happens to look right.
 * Falling back to a bare match is how a leverage ratio of 4.3% ends up pointing at
 * "the unemployment rate remained at 4.3% in April 2026" a page earlier.
 */
export function locateValue(combined: string, searchText: string, anchorText?: string): { idx: number; len: number } {
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

/** Normalized text of a page, in the same space the matcher searches. */
export async function pageText(page: import("pdfjs-dist").PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  return (textContent.items as { str: string }[])
    .map((i) => normalize(i.str))
    .filter(Boolean)
    .join(" ");
}

export async function pageContainsText(
  page: import("pdfjs-dist").PDFPageProxy,
  searchText: string,
  anchorText?: string
): Promise<boolean> {
  const combined = (await pageText(page)) + " ";
  if (anchorText && !combined.includes(normalize(anchorText))) return false;
  return locateValue(combined, searchText, anchorText).idx !== -1;
}

/** The sentence/row the figure sits in — the quotable context for an evidence record. */
export async function extractSnippet(
  page: import("pdfjs-dist").PDFPageProxy,
  searchText: string,
  anchorText?: string,
  radius = 140
): Promise<string | null> {
  const combined = (await pageText(page)) + " ";
  const { idx, len } = locateValue(combined, searchText, anchorText);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(combined.length, idx + len + radius);
  return (start > 0 ? "…" : "") + combined.slice(start, end).trim() + (end < combined.length ? "…" : "");
}

/**
 * Finds the cited figure among a page's text items and returns its box as a fraction
 * of the page, so the same geometry can be drawn at any render scale. Padding is
 * deliberately NOT applied here: a padding baked in at one scale is proportionally
 * wrong at another, which would make an exported screenshot ring a slightly different
 * area than the on-screen viewer.
 */
export async function locateOnPage(
  pdfjsLib: typeof import("pdfjs-dist"),
  page: import("pdfjs-dist").PDFPageProxy,
  searchText: string,
  anchorText?: string
): Promise<{ bbox: NormalizedBox | null; occurrences: number; textChars: number }> {
  const unit = page.getViewport({ scale: 1 });
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
  const textChars = combined.trim().length;
  if (!normalizedSearch) return { bbox: null, occurrences: 0, textChars };

  // How many times the bare figure appears at all — an unanchored match on a page with
  // several occurrences is ambiguous, and the pack has to say so.
  let occurrences = 0;
  for (const v of valueVariants(searchText)) {
    let i = indexOfValue(combined, v);
    while (i !== -1) {
      occurrences++;
      i = indexOfValue(combined, v, i + 1);
    }
    if (occurrences) break;
  }

  const { idx, len } = locateValue(combined, searchText, anchorText);
  if (idx === -1) return { bbox: null, occurrences, textChars };

  const matchEnd = idx + len;
  const matchingItems = ranges.filter((r) => r.end > idx && r.start < matchEnd).map((r) => r.item);
  if (matchingItems.length === 0) return { bbox: null, occurrences, textChars };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of matchingItems) {
    const t = pdfjsLib.Util.transform(unit.transform, item.transform);
    // item.width / item.height are in unscaled PDF page units, so at scale 1 they are
    // used as-is. The composed text matrix (t[0..3]) already bakes in the font size —
    // using its scale here would over-size the box by roughly the font size,
    // ballooning a one-line highlight into a multi-row block above the figure.
    const width = item.width;
    const height = Math.hypot(t[2], t[3]); // line height (baseline → ascent), page units
    const x = t[4];
    const y = t[5]; // text baseline, in page coordinates
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
    minY = Math.min(minY, y - height);
    maxY = Math.max(maxY, y);
  }

  return {
    bbox: {
      x: minX / unit.width,
      y: minY / unit.height,
      w: (maxX - minX) / unit.width,
      h: (maxY - minY) / unit.height,
    },
    occurrences,
    textChars,
  };
}

/** Box as a fraction of the page, so it survives any render scale. */
export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Highlight padding in PDF page units. Scaling it with the viewport is what keeps the
// exported ring the same size, relative to the text, as the one drawn on screen.
const HIGHLIGHT_PAD = 2.5;

/** Converts a normalized box into a padded pixel rect for a given render viewport. */
export function rectFor(bbox: NormalizedBox, viewport: import("pdfjs-dist").PageViewport): Rect {
  const pad = HIGHLIGHT_PAD * viewport.scale;
  return {
    left: bbox.x * viewport.width - pad,
    top: bbox.y * viewport.height - pad,
    width: bbox.w * viewport.width + pad * 2,
    height: bbox.h * viewport.height + pad * 2,
  };
}

/** How a figure's location was established — recorded so a pack can be honest about it. */
export type MatchMethod =
  | "anchored_cited_page"
  | "anchored_neighbour_page"
  | "anchored_scan"
  | "unanchored_cited_page"
  | "unanchored_scan"
  | "none";

export type ResolveStatus =
  | "located"
  | "no_search_text"
  | "page_out_of_range"
  | "value_not_found"
  | "no_text_layer";

export interface RefLocation {
  status: ResolveStatus;
  matchMethod: MatchMethod;
  pageCited?: number;
  pageResolved?: number;
  bbox?: NormalizedBox;
  occurrencesOnPage?: number;
  /** The bare figure appears more than once on the page and no label anchor pinned it. */
  ambiguous?: boolean;
  snippet?: string;
  detail?: string;
}

/** A page whose text layer is essentially empty is a scan, not a match failure. */
const MIN_TEXT_CHARS = 20;

/**
 * Resolves a citation to an exact place in a document: which page, where on it, and by
 * what method. This is the single decision procedure — the viewer and the evidence pack
 * both call it, so a pack can never point somewhere the viewer would not.
 *
 * The neighbour-page fallback exists because a recorded page number is occasionally off
 * by one, but it only runs for citations carrying a label anchor: without one, a
 * neighbouring page's lookalike number would win on nothing more than being the same
 * digits.
 */
export async function resolveRef(
  pdfjsLib: typeof import("pdfjs-dist"),
  doc: import("pdfjs-dist").PDFDocumentProxy,
  ref: { page?: number; searchText?: string; anchorText?: string },
  opts: {
    maxScanPages?: number;
    /**
     * When the cited page and its neighbours don't carry the figure, search the rest of
     * the document for the label + figure together. Off by default: the curated
     * dataset's page numbers were verified against these documents, so a miss there is
     * a finding worth reporting, not a cue to go looking elsewhere. Turn it on for
     * citations whose page number came from a live agent, where the page can disagree
     * with where the quoted sentence actually sits.
     */
    scanBeyondCitedPage?: boolean;
  } = {}
): Promise<RefLocation> {
  const { page: pageCited, searchText, anchorText } = ref;
  if (!searchText) {
    return {
      status: "no_search_text",
      matchMethod: "none",
      pageCited,
      detail: "No figure text was recorded for this citation, so there is nothing to locate on the page.",
    };
  }

  const method = (p: number): MatchMethod =>
    anchorText
      ? p === pageCited
        ? "anchored_cited_page"
        : pageCited
          ? "anchored_neighbour_page"
          : "anchored_scan"
      : pageCited
        ? "unanchored_cited_page"
        : "unanchored_scan";

  const tryPage = async (p: number): Promise<RefLocation | null> => {
    const page = await doc.getPage(p);
    try {
      const { bbox, occurrences, textChars } = await locateOnPage(pdfjsLib, page, searchText, anchorText);
      if (!bbox) {
        if (textChars < MIN_TEXT_CHARS)
          return {
            status: "no_text_layer",
            matchMethod: "none",
            pageCited,
            pageResolved: p,
            detail: "This page carries no extractable text — it is an image scan, so no figure can be located on it automatically.",
          };
        return null;
      }
      return {
        status: "located",
        matchMethod: method(p),
        pageCited,
        pageResolved: p,
        bbox,
        occurrencesOnPage: occurrences,
        ambiguous: !anchorText && occurrences > 1,
        snippet: (await extractSnippet(page, searchText, anchorText)) ?? undefined,
      };
    } finally {
      page.cleanup();
    }
  };

  if (pageCited) {
    if (pageCited > doc.numPages)
      return {
        status: "page_out_of_range",
        matchMethod: "none",
        pageCited,
        detail: `The citation names page ${pageCited}, but the document has ${doc.numPages}.`,
      };
    const hit = await tryPage(pageCited);
    if (hit) return hit;
    if (anchorText) {
      for (const candidate of [pageCited + 1, pageCited - 1]) {
        if (candidate < 1 || candidate > doc.numPages) continue;
        const near = await tryPage(candidate);
        if (near?.status === "located") return { ...near, detail: `Not on the cited page ${pageCited}; found on page ${candidate}.` };
      }
      // Widen to the whole document, when the caller allows it. Safe only because an
      // anchored match is self-validating — the metric's own label and the figure have
      // to appear together — so a hit elsewhere is evidence the recorded page was
      // wrong, not a lookalike number.
      const cap = opts.scanBeyondCitedPage ? Math.min(doc.numPages, opts.maxScanPages ?? MAX_SCAN_PAGES) : 0;
      for (let p = 1; p <= cap; p++) {
        if (p === pageCited || p === pageCited + 1 || p === pageCited - 1) continue;
        const hit = await tryPage(p);
        if (hit?.status === "located")
          return { ...hit, detail: `Not on the cited page ${pageCited}; found on page ${p}. The recorded page reference is wrong.` };
      }
    }
    return {
      status: "value_not_found",
      matchMethod: "none",
      pageCited,
      pageResolved: pageCited,
      detail: anchorText
        ? opts.scanBeyondCitedPage
          ? `The label "${anchorText}" followed by ${searchText} was not found on page ${pageCited}, nor anywhere in the first ${Math.min(
              doc.numPages,
              opts.maxScanPages ?? MAX_SCAN_PAGES
            )} pages.`
          : `The label "${anchorText}" followed by ${searchText} was not found on page ${pageCited} or either neighbouring page.`
        : `${searchText} was not found on page ${pageCited}. No label anchor is recorded for this figure, so no other page was searched.`,
    };
  }

  // No page recorded — scan from the front, bounded.
  const cap = Math.min(doc.numPages, opts.maxScanPages ?? MAX_SCAN_PAGES);
  for (let p = 1; p <= cap; p++) {
    const hit = await tryPage(p);
    if (hit?.status === "located") return hit;
  }
  return {
    status: "value_not_found",
    matchMethod: "none",
    detail: `Searched the first ${cap} page${cap === 1 ? "" : "s"} without locating ${searchText}.`,
  };
}
