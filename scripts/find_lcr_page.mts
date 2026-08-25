import { readFile } from "node:fs/promises";
import path from "node:path";
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const t = pdfjsLib.getDocument({ data: new Uint8Array(await readFile(process.argv[2])), useSystemFonts:false,
  standardFontDataUrl: path.join("/Users/aashish/Desktop/Case Comp/rbc-treasury-dashboard","node_modules","pdfjs-dist","standard_fonts")+path.sep });
const d = await t.promise;
for (let p=1;p<=d.numPages;p++){
  const pg=await d.getPage(p); const c=await pg.getTextContent();
  const txt=c.items.map(i=>("str" in i?i.str:"")).join(" ").toLowerCase();
  if (txt.includes("hqla") || (txt.includes("liquidity coverage") && txt.includes("outflow"))) {
    console.log(`p${p}: HIT`);
  }
  pg.cleanup();
}
await t.destroy();
