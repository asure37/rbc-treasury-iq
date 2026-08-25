import { readFile } from "node:fs/promises";
import path from "node:path";
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const t = pdfjsLib.getDocument({ data: new Uint8Array(await readFile(process.argv[2])), useSystemFonts:false,
  standardFontDataUrl: path.join(process.cwd(),"node_modules","pdfjs-dist","standard_fonts")+path.sep });
const d = await t.promise; console.log("pages:", d.numPages);
await t.destroy();
