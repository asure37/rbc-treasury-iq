import type { MetricKey, MetricMeta } from "@/types/metrics";

// Second verification layer: after the model proposes figures with a cited
// source, independently fetch that source document and confirm each numeric
// value's text actually appears in it. This turns "the LLM said so" into "the
// number is provably present in the primary source" — the same standard the
// rest of the dashboard's data trail holds to.

async function fetchPdfPagesText(url: string): Promise<string[] | null> {
  let buf: Uint8Array;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TreasuryIQ-Dashboard/1.0)" } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) return null;
    buf = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }

  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages: string[] = [];
    const cap = Math.min(doc.numPages, 200);
    for (let i = 1; i <= cap; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push((tc.items as { str: string }[]).map((it) => it.str).join(" ").toLowerCase());
    }
    return pages;
  } catch {
    return null;
  }
}

/**
 * For each proposed metric with a value, returns whether the formatted figure
 * text appears anywhere in the cited PDF. Returns null (unknown) for every
 * metric when the source isn't a fetchable/parseable PDF — the model's own
 * citation still stands in that case, we just can't re-check it programmatically.
 */
export async function verifyAgainstSource(
  reportUrl: string | undefined,
  metrics: Partial<Record<MetricKey, number | null>>,
  metricsMeta: MetricMeta[],
): Promise<Partial<Record<MetricKey, boolean | null>>> {
  const out: Partial<Record<MetricKey, boolean | null>> = {};
  const pages = reportUrl ? await fetchPdfPagesText(reportUrl) : null;

  for (const m of metricsMeta) {
    const v = metrics[m.key];
    if (v == null) continue;
    if (!pages) {
      out[m.key] = null;
      continue;
    }
    const formatted = v.toFixed(m.decimals);
    // Also try common alternate renderings (integer, absolute value for
    // negatives which reports often show in parentheses).
    const candidates = new Set([formatted, String(v), Math.abs(v).toFixed(m.decimals)]);
    out[m.key] = pages.some((pg) => [...candidates].some((c) => pg.includes(c)));
  }
  return out;
}
