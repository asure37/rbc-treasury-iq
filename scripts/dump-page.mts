/**
 * Print the full text of one page of a cited document, for reading table headers.
 *
 *     node scripts/dump-page.mts <bank> <period> <page> [--supp]
 *
 * Column position is meaningless without the header row that dates each column.
 * This exists so a human can read that header before deciding which number is
 * which quarter -- the judgement the extraction must not make on its own.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, ".cache", "pdfs");
const cacheName = (u: string) => createHash("sha256").update(u).digest("hex").slice(0, 16) + ".pdf";

const [bankId, period, pageArg] = process.argv.slice(2);
const useSupp = process.argv.includes("--supp");
if (!bankId || !period || !pageArg) {
  console.error('Usage: node scripts/dump-page.mts <bank> "Q2 2026" <page> [--supp]');
  process.exit(1);
}

const bank = JSON.parse(await readFile(path.join(ROOT, "data", "banks", `${bankId}.json`), "utf8"));
const q = bank.quarters.find((x: { period: string }) => x.period === period);
if (!q) { console.error(`no such period: ${period}`); process.exit(1); }

const url = (useSupp ? q.supplementaryReportUrl : q.reportUrl) as string;
const file = path.join(CACHE, cacheName(url));
if (!existsSync(file)) { console.error(`not cached: ${url}`); process.exit(1); }

console.log(`${bankId} ${period} p${pageArg}  ${url}\n${"=".repeat(80)}`);
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const task = pdfjsLib.getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: false,
  standardFontDataUrl: path.join(ROOT, "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
});
const doc = await task.promise;
const page = await doc.getPage(Number(pageArg));
const content = await page.getTextContent();
console.log(content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " "));
await task.destroy();
