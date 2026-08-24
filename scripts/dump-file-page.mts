/**
 * Print the full text of one page of an arbitrary local PDF.
 *
 *     node scripts/dump-file-page.mts <file.pdf> <page> [maxChars]
 *
 * Companion to scan-pdf.mts: once scan finds the page, this shows the column
 * headers so a value can be mapped to the right period instead of guessed at.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const [file, pageArg, maxArg] = process.argv.slice(2);
if (!file || !pageArg) {
  console.error("Usage: node scripts/dump-file-page.mts <file.pdf> <page> [maxChars]");
  process.exit(1);
}

const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const task = pdfjsLib.getDocument({
  data: new Uint8Array(await readFile(file)),
  useSystemFonts: false,
  standardFontDataUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
});
const doc = await task.promise;
const page = await doc.getPage(Number(pageArg));
const content = await page.getTextContent();
const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
console.log(text.slice(0, Number(maxArg ?? 1400)));
await task.destroy();
