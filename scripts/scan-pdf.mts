/**
 * Search any local PDF for a label and print the surrounding text.
 *
 *     node scripts/scan-pdf.mts <file.pdf> "<label>" [contextChars]
 *
 * find-metric.mts only searches documents the dataset already cites. This one takes
 * an arbitrary file, for probing a newly downloaded pack before wiring it in.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize } from "../src/lib/source-match.ts";

const [file, label, ctxArg] = process.argv.slice(2);
if (!file || !label) {
  console.error('Usage: node scripts/scan-pdf.mts <file.pdf> "<label>" [contextChars]');
  process.exit(1);
}
const ctx = Number(ctxArg ?? 150);

const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const task = pdfjsLib.getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: false,
  standardFontDataUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
});
const doc = await task.promise;
const needle = normalize(label);

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const hay = normalize(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  let i = hay.indexOf(needle);
  while (i !== -1) {
    console.log(`p${p}: ${hay.slice(i, i + ctx)}`);
    i = hay.indexOf(needle, i + needle.length);
  }
  page.cleanup();
}
await task.destroy();
