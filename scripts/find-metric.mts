/**
 * Locate a labelled figure inside the cited disclosures, for sourcing new metrics.
 *
 *     node scripts/find-metric.mts "tlac leverage ratio"
 *     node scripts/find-metric.mts "dividend payout ratio" --bank rbc
 *     node scripts/find-metric.mts "dividend payout ratio" --bank rbc --period "Q2 2026" --context 400
 *
 * This does NOT write anything. It prints what each document actually says around
 * the label, so a human can read the table and decide which column is the quarter
 * in question. Canadian supplementary packs print five or more quarters side by
 * side, so the first number after a label is frequently the WRONG one -- that
 * judgement is exactly what must not be automated away.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "../src/lib/source-match.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, ".cache", "pdfs");

const cacheName = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 16) + ".pdf";

async function main() {
  const argv = process.argv.slice(2);
  const label = argv[0];
  if (!label) return console.error('Usage: node scripts/find-metric.mts "<label>" [--bank id] [--period "Q2 2026"] [--context N]');
  const onlyBank = argv.includes("--bank") ? argv[argv.indexOf("--bank") + 1] : undefined;
  const onlyPeriod = argv.includes("--period") ? argv[argv.indexOf("--period") + 1] : undefined;
  const ctx = argv.includes("--context") ? Number(argv[argv.indexOf("--context") + 1]) : 260;
  const needle = normalize(label);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const dir = path.join(ROOT, "data", "banks");

  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const bank = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    if (onlyBank && bank.bankId !== onlyBank) continue;

    for (const q of bank.quarters) {
      if (onlyPeriod && q.period !== onlyPeriod) continue;

      // Search the quarter's own documents, most authoritative first.
      const urls = [...new Set([q.reportUrl, q.supplementaryReportUrl].filter(Boolean))] as string[];
      for (const url of urls) {
        const file = path.join(CACHE, cacheName(url));
        if (!existsSync(file)) continue;

        const task = pdfjsLib.getDocument({
          data: new Uint8Array(await readFile(file)),
          useSystemFonts: false,
          standardFontDataUrl: path.join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
        });
        const doc = await task.promise;

        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          const raw = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
          const hay = normalize(raw);
          let from = 0;
          while (true) {
            const idx = hay.indexOf(needle, from);
            if (idx === -1) break;
            from = idx + needle.length;
            const snippet = hay.slice(idx, Math.min(hay.length, idx + ctx));
            console.log(`\n${bank.bankId}  ${q.period}  p${p}  ${url.split("/").pop()}`);
            console.log(`   ${snippet}`);
          }
          page.cleanup();
        }
        await task.destroy();
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
