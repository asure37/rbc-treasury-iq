/**
 * The lineage regression check -- the highest-value test in this project.
 *
 *     node scripts/lineage-probe.ts            # check every cached document
 *     node scripts/lineage-probe.ts --download # fetch missing PDFs first (~700 MB, slow)
 *     node scripts/lineage-probe.ts --bank rbc # narrow to one issuer
 *
 * Re-resolves every sourceRef against its real PDF using `resolveRef` -- the SAME
 * function the viewer and the evidence pack call -- and reports how each one was
 * matched. It imports the engine rather than reimplementing it, on purpose: a second
 * copy would drift, and the whole product claim rests on the viewer, the pack and this
 * probe agreeing about where a number lives.
 *
 * Requires Node >= 22.18 for native TypeScript type-stripping. `source-match.ts` has no
 * runtime imports and uses erasable syntax only, so it loads directly.
 *
 * What matters is not the absolute numbers but the SHAPE:
 *
 *   - "moved to a neighbour" must stay 0. Anything else means the matcher got looser and
 *     is relocating citations -- the exact defect that once made a leverage ratio
 *     highlight a sentence about unemployment. See HANDBOOK.md section 7.
 *   - misses must not climb. A new miss is either a bad ref or a matcher regression.
 *
 * Exits 1 on regression so CI can gate on it.
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRef, type MatchMethod, type ResolveStatus } from "../src/lib/source-match.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, ".cache", "pdfs");

/**
 * Expected counts for the committed dataset, measured across all 1,034 refs.
 * Update deliberately when the data genuinely changes -- never to make a red run pass.
 */
const BASELINE = {
  anchored_cited_page: 1092,
  unanchored_cited_page: 108,
  neighbour: 0,
  // 217 refs record no searchText at all (48 of them the LCR buffer, a computed
  // surplus whose ref cites the page disclosing HQLA and outflows): 81 legacy derived figures, TD's and
  // Scotiabank's 16 computed ROA refs, and the 48 equity-multiplier refs. Each of
  // those cites the page where its OPERANDS are disclosed; the ratio itself is
  // never printed, so there is nothing to highlight. 16 record a value not on the page.
  misses: 247,
};

interface Probe {
  bank: string;
  period: string;
  metric: string;
  url: string;
  page?: number;
  searchText?: string;
  anchorText?: string;
}

function cacheName(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16) + ".pdf";
}

async function collectRefs(only?: string): Promise<Probe[]> {
  const dir = path.join(ROOT, "data", "banks");
  const out: Probe[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const bank = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    if (only && bank.bankId !== only) continue;
    for (const q of bank.quarters) {
      for (const [metric, ref] of Object.entries((q.sourceRefs ?? {}) as Record<string, Probe>)) {
        out.push({
          bank: bank.bankId,
          period: q.period,
          metric,
          url: ref.url || q.reportUrl,
          page: ref.page,
          searchText: ref.searchText,
          anchorText: ref.anchorText,
        });
      }
    }
  }
  return out;
}

async function download(urls: string[]): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  const missing = urls.filter((u) => !existsSync(path.join(CACHE, cacheName(u))));
  if (!missing.length) return console.log("All documents already cached.\n");
  console.log(`Downloading ${missing.length} document(s) to .cache/pdfs ...`);
  let done = 0;
  for (const url of missing) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // A captive portal or error page would otherwise be cached as if it were the report.
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
      await writeFile(path.join(CACHE, cacheName(url)), buf);
      process.stdout.write(`\r  ${++done}/${missing.length}`);
    } catch (err) {
      console.warn(`\n  skip ${url}: ${(err as Error).message}`);
    }
  }
  console.log("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes("--bank") ? argv[argv.indexOf("--bank") + 1] : undefined;

  const refs = await collectRefs(only);
  const urls = [...new Set(refs.map((r) => r.url))];
  console.log(`${refs.length} refs across ${urls.length} documents${only ? ` (${only} only)` : ""}\n`);

  if (argv.includes("--download")) await download(urls);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const byMethod = new Map<MatchMethod, number>();
  const byStatus = new Map<ResolveStatus, number>();
  const misses: string[] = [];
  const moved: string[] = [];
  let uncached = 0;

  for (const url of urls) {
    const file = path.join(CACHE, cacheName(url));
    const mine = refs.filter((r) => r.url === url);
    if (!existsSync(file)) {
      uncached += mine.length;
      continue;
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(await readFile(file)),
      useSystemFonts: false,
      // Without this pdf.js warns on every page that embeds a standard font.
      standardFontDataUrl: path.join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
    });
    const doc = await loadingTask.promise;

    for (const ref of mine) {
      const where = `${ref.bank} ${ref.period} ${ref.metric}`;
      try {
        const loc = await resolveRef(pdfjsLib, doc, ref);
        byMethod.set(loc.matchMethod, (byMethod.get(loc.matchMethod) ?? 0) + 1);
        byStatus.set(loc.status, (byStatus.get(loc.status) ?? 0) + 1);
        if (loc.matchMethod === "anchored_neighbour_page")
          moved.push(`${where}: cited p${loc.pageCited} -> resolved p${loc.pageResolved}`);
        else if (loc.status !== "located")
          misses.push(`${where}: ${loc.status} (p${ref.page}, "${ref.searchText}")`);
      } catch (err) {
        misses.push(`${where}: threw ${(err as Error).message}`);
      }
    }
    await loadingTask.destroy();
    process.stdout.write(`\r  resolved ${[...byMethod.values()].reduce((a, b) => a + b, 0)} refs`);
  }
  console.log("\n");

  const n = (m: MatchMethod) => byMethod.get(m) ?? 0;
  const rows: [string, number, number | null][] = [
    ["resolve ON the cited page via anchor", n("anchored_cited_page"), BASELINE.anchored_cited_page],
    ["resolve ON the cited page unanchored", n("unanchored_cited_page"), BASELINE.unanchored_cited_page],
    ["moved to a neighbour", n("anchored_neighbour_page"), BASELINE.neighbour],
    ["no highlight (honest miss)", misses.length, BASELINE.misses],
  ];
  // A filtered or partially-cached run covers a subset, so the full-dataset baseline
  // would only mislead -- show it just when the run is actually comparable.
  const comparable = !only && !uncached;
  for (const [label, got, want] of rows) {
    const flag = !comparable || want === null || got === want ? "" : `   <- baseline ${want}`;
    console.log(`${label.padEnd(40)}${String(got).padStart(5)}${flag}`);
  }
  if (!comparable) console.log("\n(subset run -- baseline comparison suppressed)");
  if (uncached) console.log(`\n${uncached} ref(s) skipped -- document not cached. Re-run with --download.`);

  // The two miss kinds need different fixes, so never report them as one number:
  // no_search_text is a gap in the DATA (no figure was ever recorded to look for),
  // value_not_found is a gap in the MATCH (a figure was recorded but isn't on the page).
  const missKinds: ResolveStatus[] = ["no_search_text", "value_not_found", "no_text_layer", "page_out_of_range"];
  if (missKinds.some((s) => byStatus.get(s))) {
    console.log("\nMiss breakdown:");
    for (const s of missKinds) {
      const n = byStatus.get(s) ?? 0;
      if (n) console.log(`  ${s.padEnd(26)}${String(n).padStart(5)}`);
    }
  }

  if (moved.length) {
    console.log(`\nRELOCATED CITATIONS (${moved.length}) -- the matcher has been loosened:`);
    moved.slice(0, 20).forEach((m) => console.log(`  ${m}`));
  }
  if (misses.length) {
    // Print every one. Truncating here once hid three genuine regressions behind
    // a count that had only moved by three -- the diagnostic has to show its work.
    console.log(`\nMisses (${misses.length}):`);
    misses.forEach((m) => console.log(`  ${m}`));
  }

  const regressed =
    n("anchored_neighbour_page") > BASELINE.neighbour ||
    (!uncached && !only && misses.length > BASELINE.misses);
  if (regressed) {
    console.error("\nREGRESSION: citations are moving, or misses have climbed.");
    process.exit(1);
  }
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
