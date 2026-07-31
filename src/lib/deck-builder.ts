"use client";

import PptxGenJS from "pptxgenjs";
import { jsPDF } from "jspdf";
import type { BankData, MetricKey, MetricMeta } from "@/types/metrics";

export interface DeckRequest {
  title: string;
  subtitle: string;
  bankIds: string[];
  metricKeys: MetricKey[];
  period: string;
  /** Which visuals to include. */
  charts: { ranking: boolean; trend: boolean; table: boolean; heatmap: boolean };
  /** Free-text styling/《narrative》 direction from the analyst. */
  instructions: string;
  accent: string;
  theme: "light" | "dark";
}

const RBC_BLUE = "0051A5";
const hex = (c: string) => c.replace("#", "").toUpperCase();

function fmt(v: number | null | undefined, m: MetricMeta): string {
  if (v == null) return "—";
  if (m.unit === "$B") return `$${v.toLocaleString(undefined, { maximumFractionDigits: m.decimals })}B`;
  if (m.unit === "$M") return `$${v.toLocaleString(undefined, { maximumFractionDigits: m.decimals })}M`;
  return `${v.toFixed(m.decimals)}%`;
}

const valueOf = (b: BankData, key: MetricKey, period: string) =>
  b.quarters.find((q) => q.period === period)?.metrics[key] ?? null;

/** Ordered periods present across the selected banks (oldest → newest). */
function periodsOf(banks: BankData[], upTo: string, count = 8): string[] {
  const map = new Map<string, string>();
  for (const b of banks) for (const q of b.quarters) map.set(q.period, q.periodEnd);
  const all = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([p]) => p);
  const idx = all.indexOf(upTo);
  const end = idx === -1 ? all.length : idx + 1;
  return all.slice(Math.max(0, end - count), end);
}

interface RankedPoint { bank: BankData; value: number }

/** Best-first ordering for a metric, direction-aware, skipping undisclosed banks. */
function rankBanks(banks: BankData[], m: MetricMeta, period: string): RankedPoint[] {
  return banks
    .map((b) => ({ bank: b, value: valueOf(b, m.key, period) }))
    .filter((p): p is RankedPoint => p.value != null)
    .sort((a, b) => (m.higherIsBetter === false ? a.value - b.value : b.value - a.value));
}

const gapUnit = (m: MetricMeta) => (m.unit === "%" ? "pp" : "");
/** Signed gap, or null when the difference rounds away at the metric's precision. */
function signedGap(d: number, m: MetricMeta): string | null {
  if (Math.abs(d) < 0.5 * 10 ** -m.decimals) return null;
  return `${d > 0 ? "+" : ""}${d.toFixed(m.decimals)}${gapUnit(m)}`;
}

/** One-line read of where the home bank sits on a metric — used on the summary slide/page. */
function summaryLine(m: MetricMeta, pts: RankedPoint[], home: BankData | undefined): string {
  const lead = pts[0];
  const pos = pts.findIndex((p) => p.bank.bankId === home?.bankId) + 1;
  const mine = pts.find((p) => p.bank.bankId === home?.bankId);
  if (!mine || !home) return `${m.label}: ${lead.bank.ticker} leads at ${fmt(lead.value, m)}.`;
  if (pos === 1) {
    const next = pts[1];
    const ahead = next ? signedGap(mine.value - next.value, m) : null;
    return `${m.label}: ${home.ticker} leads at ${fmt(mine.value, m)}${next ? `, ${ahead ?? "level"} against ${next.bank.ticker}` : ""}.`;
  }
  const gap = signedGap(mine.value - lead.value, m);
  return `${m.label}: ${lead.bank.ticker} leads at ${fmt(lead.value, m)}; ${home.ticker} ranks ${pos} of ${pts.length} at ${fmt(mine.value, m)}${gap ? ` (${gap} vs leader)` : ""}.`;
}

/** The commentary rail that sits beside every ranking chart. */
function readAcross(m: MetricMeta, pts: RankedPoint[], home: BankData | undefined): string[] {
  const lead = pts[0];
  const last = pts[pts.length - 1];
  const avg = pts.reduce((s, p) => s + p.value, 0) / pts.length;
  const mine = pts.find((p) => p.bank.bankId === home?.bankId);
  const pos = pts.findIndex((p) => p.bank.bankId === home?.bankId) + 1;
  const notes = [
    `Leader: ${lead.bank.ticker} at ${fmt(lead.value, m)}`,
    `Peer average: ${fmt(avg, m)}`,
    `Spread: ${Math.abs(lead.value - last.value).toFixed(m.decimals)}${gapUnit(m)} across ${pts.length} banks`,
  ];
  if (mine && home) {
    const d = signedGap(mine.value - avg, m);
    notes.push(`${home.ticker}: ${fmt(mine.value, m)} — rank ${pos} of ${pts.length}, ${d ? `${d} vs peer average` : "in line with the peer average"}`);
  }
  if (m.regulatoryMinimum != null) notes.push(`Regulatory minimum: ${m.regulatoryMinimum}%`);
  return notes;
}

// ---------------------------------------------------------------- PowerPoint
export async function buildPptx(req: DeckRequest, banks: BankData[], meta: MetricMeta[]): Promise<Blob> {
  const sel = banks.filter((b) => req.bankIds.includes(b.bankId));
  const metrics = meta.filter((m) => req.metricKeys.includes(m.key));
  const dark = req.theme === "dark";
  const bg = dark ? "0C1424" : "FFFFFF";
  const panel = dark ? "121D33" : "F4F7FB";
  const fg = dark ? "EEF4FC" : "16233A";
  const muted = dark ? "A8BBD6" : "5A6B85";
  const rule = dark ? "27364F" : "DCE3ED";
  const accent = hex(req.accent || RBC_BLUE);
  const home = sel.find((b) => b.isHomeInstitution) ?? sel[0];
  const asOf = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "RBC Treasury Intelligence";
  pptx.company = "RBC Corporate Treasury";
  pptx.title = req.title;

  // Content master: thin accent rule, footer, automatic slide numbers.
  pptx.defineSlideMaster({
    title: "TIQ_CONTENT",
    background: { color: bg },
    objects: [
      { rect: { x: 0, y: 0, w: "100%", h: 0.06, fill: { color: accent } } },
      { line: { x: 0.5, y: 1.02, w: 12.3, h: 0, line: { color: rule, width: 0.75 } } },
      { text: { text: `${req.title}  ·  ${req.period}`, options: { x: 0.5, y: 6.95, w: 8, h: 0.3, fontSize: 9, color: muted, fontFace: "Calibri" } } },
    ],
    slideNumber: { x: 12.6, y: 6.95, w: 0.4, h: 0.3, fontSize: 9, color: muted, align: "right" },
  });
  pptx.defineSlideMaster({ title: "TIQ_SECTION", background: { color: dark ? "0A1120" : accent } });

  const H1 = (s: PptxGenJS.Slide, text: string, sub?: string) => {
    s.addText(text, { x: 0.5, y: 0.32, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg, fontFace: "Calibri" });
    if (sub) s.addText(sub, { x: 0.5, y: 0.74, w: 12.3, h: 0.3, fontSize: 10.5, color: muted, fontFace: "Calibri" });
  };

  const ranked = (m: MetricMeta) => rankBanks(sel, m, req.period);

  // ---------------------------------------------------------------- cover
  const t = pptx.addSlide();
  t.background = { color: dark ? "0A1120" : "0C1424" };
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: accent } });
  t.addText("RBC TREASURY INTELLIGENCE", { x: 0.9, y: 1.9, w: 11.5, h: 0.3, fontSize: 11, color: accent, charSpacing: 3, fontFace: "Calibri" });
  t.addText(req.title, { x: 0.9, y: 2.35, w: 11.5, h: 1.1, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  t.addText(req.subtitle, { x: 0.9, y: 3.5, w: 11.5, h: 0.4, fontSize: 15, color: "A8BBD6", fontFace: "Calibri" });
  t.addShape(pptx.ShapeType.rect, { x: 0.9, y: 4.15, w: 2.2, h: 0.03, fill: { color: accent } });
  t.addText(`${sel.map((b) => b.ticker).join("   ·   ")}`, { x: 0.9, y: 4.4, w: 11.5, h: 0.35, fontSize: 13, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  t.addText(`${req.period}  |  Prepared ${asOf}`, { x: 0.9, y: 4.8, w: 11.5, h: 0.3, fontSize: 11, color: "A8BBD6", fontFace: "Calibri" });
  if (req.instructions.trim())
    t.addText(`Prepared to instruction: ${req.instructions.trim()}`, { x: 0.9, y: 5.35, w: 10.5, h: 0.6, fontSize: 10, italic: true, color: "8FA3C0", fontFace: "Calibri" });
  t.addText("Figures sourced from each institution's own published disclosures.", { x: 0.9, y: 6.6, w: 11.5, h: 0.3, fontSize: 9, color: "6B7F9E", fontFace: "Calibri" });

  // ------------------------------------------------------------- contents
  const toc = pptx.addSlide({ masterName: "TIQ_CONTENT" });
  H1(toc, "Contents");
  const items: string[] = ["Executive summary"];
  if (req.charts.table) items.push("Peer comparison table");
  if (req.charts.heatmap) items.push("Competitive standing heat map");
  if (req.charts.ranking) items.push(`Metric rankings (${metrics.length} charts)`);
  if (req.charts.trend) items.push(`Trends over time (${metrics.length} charts)`);
  items.push("Sources & methodology");
  items.forEach((it, i) => {
    toc.addShape(pptx.ShapeType.ellipse, { x: 0.7, y: 1.45 + i * 0.62, w: 0.34, h: 0.34, fill: { color: accent } });
    toc.addText(String(i + 1), { x: 0.7, y: 1.45 + i * 0.62, w: 0.34, h: 0.34, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    toc.addText(it, { x: 1.25, y: 1.45 + i * 0.62, w: 10, h: 0.34, fontSize: 14, color: fg, valign: "middle", fontFace: "Calibri" });
  });

  // ---------------------------------------------------- executive summary
  const ex = pptx.addSlide({ masterName: "TIQ_CONTENT" });
  H1(ex, "Executive summary", `${home?.bankName ?? "Home institution"} versus ${sel.length - 1} Canadian peers · ${req.period}`);
  const cards = metrics.slice(0, 4).map((m) => {
    const r = ranked(m);
    const pos = r.findIndex((p) => p.bank.bankId === home?.bankId) + 1;
    const v = valueOf(home, m.key, req.period);
    return { label: m.shortLabel, value: fmt(v, m), rank: pos ? `Rank ${pos} of ${r.length}` : "Not disclosed" };
  });
  cards.forEach((c, i) => {
    const x = 0.5 + i * 3.13;
    ex.addShape(pptx.ShapeType.roundRect, { x, y: 1.3, w: 2.95, h: 1.5, fill: { color: panel }, line: { color: rule, width: 0.75 }, rectRadius: 0.08 });
    ex.addText(c.label.toUpperCase(), { x: x + 0.15, y: 1.42, w: 2.65, h: 0.26, fontSize: 9, color: muted, charSpacing: 1, fontFace: "Calibri" });
    ex.addText(c.value, { x: x + 0.15, y: 1.7, w: 2.65, h: 0.6, fontSize: 26, bold: true, color: fg, fontFace: "Calibri" });
    ex.addText(c.rank, { x: x + 0.15, y: 2.32, w: 2.65, h: 0.28, fontSize: 10, color: accent, fontFace: "Calibri" });
  });
  const bullets = metrics
    .map((m) => ({ m, r: ranked(m) }))
    .filter(({ r }) => r.length > 0)
    .slice(0, 7)
    .map(({ m, r }) => ({
      text: summaryLine(m, r, home),
      options: { fontSize: 11.5, color: fg, bullet: { code: "25AA" }, breakLine: true, paraSpaceAfter: 6, fontFace: "Calibri" },
    }));
  ex.addText(bullets as never, { x: 0.6, y: 3.15, w: 12.1, h: 3.4 });

  const section = (label: string, n: string) => {
    const s = pptx.addSlide({ masterName: "TIQ_SECTION" });
    s.addText(n, { x: 0.9, y: 2.6, w: 11.5, h: 0.5, fontSize: 13, color: dark ? accent : "CFE2FF", charSpacing: 3, fontFace: "Calibri" });
    s.addText(label, { x: 0.9, y: 3.05, w: 11.5, h: 1, fontSize: 34, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  };

  // ------------------------------------------------------ comparison table
  if (req.charts.table) {
    const s = pptx.addSlide({ masterName: "TIQ_CONTENT" });
    H1(s, "Peer comparison", `All selected metrics · ${req.period}`);
    const head = [
      { text: "Metric", options: { bold: true, color: "FFFFFF", fill: { color: accent }, fontFace: "Calibri" } },
      ...sel.map((b) => ({ text: b.ticker, options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: "center" as const, fontFace: "Calibri" } })),
    ];
    const rows = metrics.map((m, i) => {
      const r = ranked(m);
      const best = r[0]?.bank.bankId;
      const zebra = i % 2 === 1 ? panel : bg;
      return [
        { text: m.shortLabel, options: { color: fg, bold: true, fill: { color: zebra }, fontFace: "Calibri" } },
        ...sel.map((b) => {
          const v = valueOf(b, m.key, req.period);
          const isBest = b.bankId === best && v != null;
          return {
            text: fmt(v, m),
            options: { color: isBest ? "FFFFFF" : fg, bold: isBest, align: "center" as const, fill: { color: isBest ? "1F6F4A" : zebra }, fontFace: "Calibri" },
          };
        }),
      ];
    });
    s.addTable([head, ...rows], {
      x: 0.5, y: 1.22, w: 12.3, fontSize: 11, rowH: 0.32,
      border: { type: "solid", pt: 0.5, color: rule }, valign: "middle",
    });
    s.addText("Green marks the strongest bank on each metric (direction-aware).", { x: 0.5, y: 6.55, w: 12.3, h: 0.3, fontSize: 9, italic: true, color: muted, fontFace: "Calibri" });
  }

  // --------------------------------------------------------- heat map
  if (req.charts.heatmap) {
    const s = pptx.addSlide({ masterName: "TIQ_CONTENT" });
    H1(s, "Competitive standing", `Value and rank per metric · ${req.period}`);
    const head = [
      { text: "Institution", options: { bold: true, color: "FFFFFF", fill: { color: accent }, fontFace: "Calibri" } },
      ...metrics.map((m) => ({ text: m.shortLabel, options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: "center" as const, fontFace: "Calibri" } })),
    ];
    const order = sel
      .map((b) => {
        const avg = metrics.map((m) => {
          const r = ranked(m);
          const i = r.findIndex((p) => p.bank.bankId === b.bankId);
          return i === -1 ? null : i + 1;
        }).filter((x): x is number => x != null);
        return { bank: b, avg: avg.length ? avg.reduce((s, x) => s + x, 0) / avg.length : 99 };
      })
      .sort((a, b) => a.avg - b.avg);
    const rows = order.map(({ bank, avg }) => [
      { text: `${bank.ticker}`, options: { bold: true, color: fg, fontFace: "Calibri" } },
      ...metrics.map((m) => {
        const r = ranked(m);
        const i = r.findIndex((p) => p.bank.bankId === bank.bankId);
        const v = valueOf(bank, m.key, req.period);
        if (i === -1 || v == null) return { text: "—", options: { align: "center" as const, color: muted, fontFace: "Calibri" } };
        const third = Math.ceil(r.length / 3);
        const fill = i < third ? "1F6F4A" : i >= r.length - third ? "7A2230" : dark ? "1B2942" : "E8EDF5";
        const col = i < third || i >= r.length - third ? "FFFFFF" : fg;
        return { text: `${fmt(v, m)}\n#${i + 1}`, options: { align: "center" as const, color: col, fill: { color: fill }, fontSize: 9, fontFace: "Calibri" } };
      }),
      { text: avg === 99 ? "—" : avg.toFixed(1), options: { align: "center" as const, bold: true, color: accent, fontFace: "Calibri" } },
    ]);
    s.addTable([[...head, { text: "Avg rank", options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: "center" as const, fontFace: "Calibri" } }], ...rows], {
      x: 0.4, y: 1.22, w: 12.5, fontSize: 9.5, rowH: 0.5, valign: "middle",
      border: { type: "solid", pt: 0.5, color: rule },
    });
    s.addText("Ranked by average standing across the selected metrics. Green = top third, red = bottom third.", { x: 0.4, y: 6.55, w: 12.5, h: 0.3, fontSize: 9, italic: true, color: muted, fontFace: "Calibri" });
  }

  // ------------------------------------------------------ ranking charts
  if (req.charts.ranking && metrics.length) {
    section("Metric rankings", "SECTION 01");
    for (const m of metrics) {
      const pts = ranked(m);
      if (!pts.length) continue;
      const s = pptx.addSlide({ masterName: "TIQ_CONTENT" });
      H1(s, m.label, m.description);
      // One data point per bank, coloured by that bank's brand colour.
      s.addChart(
        pptx.ChartType.bar,
        [{ name: m.shortLabel, labels: pts.map((p) => p.bank.ticker), values: pts.map((p) => p.value) }],
        {
          x: 0.6, y: 1.35, w: 8.6, h: 4.9, barDir: "bar",
          // pptxgenjs colours per data point (not per series) when a single-series bar
          // chart is given more than one chart colour — that's what restores brand colours.
          chartColors: pts.map((p) => hex(p.bank.colorHex)),
          showValue: true, dataLabelPosition: "outEnd", dataLabelColor: fg, dataLabelFontSize: 11,
          catAxisLabelColor: muted, valAxisLabelColor: muted, catAxisLabelFontSize: 11,
          valGridLine: { color: rule, size: 1 }, catGridLine: { style: "none" },
          showLegend: false, showTitle: false,
          dataLabelFormatCode: m.unit === "%" ? `0.${"0".repeat(m.decimals)}"%"` : "#,##0",
        }
      );
      // commentary rail
      s.addShape(pptx.ShapeType.roundRect, { x: 9.45, y: 1.35, w: 3.35, h: 4.9, fill: { color: panel }, line: { color: rule, width: 0.75 }, rectRadius: 0.08 });
      s.addText("READ-ACROSS", { x: 9.65, y: 1.5, w: 3, h: 0.25, fontSize: 9, color: accent, charSpacing: 2, fontFace: "Calibri" });
      s.addText(
        readAcross(m, pts, home).map((n, i, arr) => ({
          text: n,
          options: { fontSize: 11, color: fg, bullet: true, breakLine: true, paraSpaceAfter: i === arr.length - 1 ? 0 : 8, fontFace: "Calibri" },
        })) as never,
        { x: 9.65, y: 1.85, w: 3, h: 4.2 }
      );
    }
  }

  // -------------------------------------------------------- trend charts
  if (req.charts.trend && metrics.length) {
    const periods = periodsOf(sel, req.period);
    section("Trends over time", "SECTION 02");
    for (const m of metrics) {
      const series = sel
        .map((b) => ({ name: b.ticker, labels: periods, values: periods.map((p) => valueOf(b, m.key, p) ?? null) }))
        .filter((s) => s.values.some((v) => v != null));
      if (!series.length) continue;
      const s = pptx.addSlide({ masterName: "TIQ_CONTENT" });
      H1(s, `${m.label} — trend`, `${periods[0]} to ${periods[periods.length - 1]}`);
      s.addChart(pptx.ChartType.line, series as never, {
        x: 0.6, y: 1.35, w: 12.1, h: 4.9,
        chartColors: sel.map((b) => hex(b.colorHex)), lineDataSymbol: "circle", lineDataSymbolSize: 5, lineSize: 2.5,
        catAxisLabelColor: muted, valAxisLabelColor: muted, valGridLine: { color: rule, size: 1 }, catGridLine: { style: "none" },
        showLegend: true, legendPos: "b", legendColor: muted, showTitle: false, lineSmooth: false,
      });
      const first = series.map((sr) => sr.values.find((v) => v != null) as number | undefined);
      const lastV = series.map((sr) => [...sr.values].reverse().find((v) => v != null) as number | undefined);
      const movers = series
        .map((sr, i) => ({ name: sr.name, delta: first[i] != null && lastV[i] != null ? (lastV[i] as number) - (first[i] as number) : null }))
        .filter((x) => x.delta != null)
        .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));
      if (movers.length)
        s.addText(
          `Largest move over the window: ${movers[0].name} ${(movers[0].delta as number) >= 0 ? "+" : ""}${(movers[0].delta as number).toFixed(m.decimals)}${m.unit === "%" ? "pp" : ""}.`,
          { x: 0.6, y: 6.4, w: 12.1, h: 0.3, fontSize: 10, italic: true, color: muted, fontFace: "Calibri" }
        );
    }
  }

  // -------------------------------------------------------------- sources
  const src = pptx.addSlide({ masterName: "TIQ_CONTENT" });
  H1(src, "Sources & methodology", "Every figure traces to the institution's own published disclosure");
  const srcRows = sel.map((b) => {
    const q = b.quarters.find((x) => x.period === req.period);
    return [
      { text: b.bankName, options: { color: fg, bold: true, fontFace: "Calibri" } },
      { text: q?.reportName ?? "Quarterly disclosure", options: { color: muted, fontFace: "Calibri" } },
    ];
  });
  src.addTable(
    [[{ text: "Institution", options: { bold: true, color: "FFFFFF", fill: { color: accent }, fontFace: "Calibri" } },
      { text: "Primary source for this period", options: { bold: true, color: "FFFFFF", fill: { color: accent }, fontFace: "Calibri" } }], ...srcRows],
    { x: 0.5, y: 1.3, w: 12.3, colW: [4.3, 8], fontSize: 11, rowH: 0.36, valign: "middle", border: { type: "solid", pt: 0.5, color: rule } }
  );
  src.addText(
    [
      { text: "Figures are taken from each bank's own quarterly Report to Shareholders, supplementary financial information or regulatory disclosure — not third-party aggregators.", options: { fontSize: 10.5, color: fg, bullet: true, breakLine: true, paraSpaceAfter: 6, fontFace: "Calibri" } },
      { text: "Rankings are direction-aware: for efficiency ratio and risk-sensitivity measures, a lower value ranks better.", options: { fontSize: 10.5, color: fg, bullet: true, breakLine: true, paraSpaceAfter: 6, fontFace: "Calibri" } },
      { text: "Ratios we compute (rather than quote) are noted as such in the dashboard's data-lineage view, where each figure links to the page it appears on.", options: { fontSize: 10.5, color: fg, bullet: true, breakLine: true, fontFace: "Calibri" } },
    ] as never,
    { x: 0.6, y: 1.55 + srcRows.length * 0.36 + 0.5, w: 12.1, h: 1.8 }
  );

  return (await pptx.write({ outputType: "blob" })) as Blob;
}

// ---------------------------------------------------------------------- PDF
export function buildPdf(req: DeckRequest, banks: BankData[], meta: MetricMeta[]): Blob {
  const sel = banks.filter((b) => req.bankIds.includes(b.bankId));
  const metrics = meta.filter((m) => req.metricKeys.includes(m.key));
  const home = sel.find((b) => b.isHomeInstitution) ?? sel[0];
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Print-friendly palette regardless of the on-screen theme.
  const accent = req.accent || `#${RBC_BLUE}`;
  const INK = "#12203A";
  const BODY = "#33405A";
  const MUTED = "#5A6B85";
  const RULE = "#DCE3ED";
  const PANEL = "#F4F7FB";
  const M = 40; // page margin
  const asOf = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  const ranked = (m: MetricMeta) => rankBanks(sel, m, req.period);

  /** New content page with the standard header. Returns the first usable y. */
  const page = (title: string, sub?: string): number => {
    doc.addPage();
    doc.setFillColor(accent).rect(0, 0, W, 4, "F");
    doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(INK).text(title, M, 46);
    if (sub) doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(MUTED).text(sub, M, 62);
    doc.setDrawColor(RULE).setLineWidth(0.7).line(M, 72, W - M, 72);
    doc.setFont("helvetica", "normal");
    return 96;
  };

  // ------------------------------------------------------------------ cover
  doc.setFillColor("#0C1424").rect(0, 0, W, H, "F");
  doc.setFillColor(accent).rect(0, 0, 10, H, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(accent).text("RBC TREASURY INTELLIGENCE", 56, 150);
  doc.setFontSize(30).setTextColor("#FFFFFF").text(doc.splitTextToSize(req.title, W - 140), 56, 196);
  doc.setFont("helvetica", "normal").setFontSize(13).setTextColor("#A8BBD6").text(req.subtitle, 56, 232);
  doc.setFillColor(accent).rect(56, 254, 110, 2.5, "F");
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor("#FFFFFF").text(sel.map((b) => b.ticker).join("   ·   "), 56, 288);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor("#A8BBD6").text(`${req.period}   |   Prepared ${asOf}`, 56, 308);
  if (req.instructions.trim()) {
    doc.setFontSize(9).setTextColor("#8FA3C0");
    doc.text(doc.splitTextToSize(`Prepared to instruction: ${req.instructions.trim()}`, W - 160), 56, 342);
  }
  doc.setFontSize(8.5).setTextColor("#6B7F9E").text("Figures sourced from each institution's own published disclosures.", 56, H - 44);

  // ------------------------------------------------------- executive summary
  {
    let y = page("Executive summary", `${home?.bankName ?? "Home institution"} versus ${sel.length - 1} Canadian peers · ${req.period}`);
    const cards = metrics.slice(0, 4);
    const cw = (W - 2 * M - 3 * 12) / 4;
    cards.forEach((m, i) => {
      const r = ranked(m);
      const pos = r.findIndex((p) => p.bank.bankId === home?.bankId) + 1;
      const x = M + i * (cw + 12);
      doc.setFillColor(PANEL).roundedRect(x, y, cw, 76, 4, 4, "F");
      doc.setDrawColor(RULE).roundedRect(x, y, cw, 76, 4, 4, "S");
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(MUTED).text(m.shortLabel.toUpperCase(), x + 12, y + 20);
      doc.setFont("helvetica", "bold").setFontSize(21).setTextColor(INK).text(fmt(valueOf(home, m.key, req.period), m), x + 12, y + 48);
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(accent).text(pos ? `Rank ${pos} of ${r.length}` : "Not disclosed", x + 12, y + 66);
    });
    y += 108;
    doc.setFontSize(10).setTextColor(BODY);
    for (const m of metrics) {
      const r = ranked(m);
      if (!r.length) continue;
      const wrapped = doc.splitTextToSize(summaryLine(m, r, home), W - 2 * M - 16) as string[];
      if (y + wrapped.length * 13 > H - 46) break;
      doc.setFillColor(accent).circle(M + 3, y - 3.5, 2, "F");
      doc.setTextColor(BODY).text(wrapped, M + 14, y);
      y += wrapped.length * 13 + 7;
    }
  }

  // -------------------------------------------------------- comparison table
  if (req.charts.table) {
    let y = page("Peer comparison", `All selected metrics · ${req.period}`);
    const labelW = 190;
    const colW = (W - 2 * M - labelW) / Math.max(sel.length, 1);
    const header = () => {
      doc.setFillColor(accent).rect(M, y - 15, W - 2 * M, 22, "F");
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#FFFFFF").text("Metric", M + 8, y);
      sel.forEach((b, i) => doc.text(b.ticker, M + labelW + i * colW + colW / 2, y, { align: "center" }));
      doc.setFont("helvetica", "normal");
      y += 26;
    };
    header();
    metrics.forEach((m, idx) => {
      if (y > H - 52) { y = page("Peer comparison (cont.)", req.period); header(); }
      const best = ranked(m)[0]?.bank.bankId;
      if (idx % 2 === 1) doc.setFillColor(PANEL).rect(M, y - 12, W - 2 * M, 20, "F");
      doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(INK).text(m.shortLabel, M + 8, y);
      doc.setFont("helvetica", "normal");
      sel.forEach((b, i) => {
        const v = valueOf(b, m.key, req.period);
        const cx = M + labelW + i * colW + colW / 2;
        const isBest = b.bankId === best && v != null;
        if (isBest) doc.setFillColor("#1F6F4A").roundedRect(cx - 30, y - 11, 60, 17, 2.5, 2.5, "F");
        doc.setFont("helvetica", isBest ? "bold" : "normal").setTextColor(isBest ? "#FFFFFF" : BODY).text(fmt(v, m), cx, y, { align: "center" });
      });
      doc.setFont("helvetica", "normal");
      doc.setDrawColor(RULE).line(M, y + 8, W - M, y + 8);
      y += 22;
    });
    doc.setFontSize(8).setTextColor(MUTED).text("Green marks the strongest bank on each metric (direction-aware).", M, Math.min(y + 14, H - 40));
  }

  // ---------------------------------------------------------------- heat map
  if (req.charts.heatmap) {
    let y = page("Competitive standing", `Value and rank per metric · ${req.period}`);
    const nameW = 120;
    const cellW = (W - 2 * M - nameW - 60) / Math.max(metrics.length, 1);
    doc.setFillColor(accent).rect(M, y - 15, W - 2 * M, 22, "F");
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#FFFFFF").text("Institution", M + 8, y);
    metrics.forEach((m, i) => doc.text(doc.splitTextToSize(m.shortLabel, cellW - 6)[0] as string, M + nameW + i * cellW + cellW / 2, y, { align: "center" }));
    doc.text("Avg", W - M - 30, y, { align: "center" });
    y += 24;
    const order = sel
      .map((b) => {
        const ranksFor = metrics
          .map((m) => { const i = ranked(m).findIndex((p) => p.bank.bankId === b.bankId); return i === -1 ? null : i + 1; })
          .filter((x): x is number => x != null);
        return { bank: b, avg: ranksFor.length ? ranksFor.reduce((s, x) => s + x, 0) / ranksFor.length : 99 };
      })
      .sort((a, b) => a.avg - b.avg);
    const rowH = Math.min(46, (H - y - 60) / Math.max(order.length, 1));
    for (const { bank, avg } of order) {
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK).text(bank.ticker, M + 8, y + rowH / 2 + 3);
      doc.setFillColor(bank.colorHex).rect(M, y + rowH / 2 - 6, 3.5, 12, "F");
      metrics.forEach((m, i) => {
        const r = ranked(m);
        const rank = r.findIndex((p) => p.bank.bankId === bank.bankId);
        const cx = M + nameW + i * cellW;
        const v = valueOf(bank, m.key, req.period);
        if (rank === -1 || v == null) {
          doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED).text("—", cx + cellW / 2, y + rowH / 2 + 3, { align: "center" });
          return;
        }
        const third = Math.ceil(r.length / 3);
        const top = rank < third, bottom = rank >= r.length - third;
        doc.setFillColor(top ? "#1F6F4A" : bottom ? "#7A2230" : "#E8EDF5").roundedRect(cx + 2, y + 2, cellW - 4, rowH - 4, 3, 3, "F");
        doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(top || bottom ? "#FFFFFF" : INK).text(fmt(v, m), cx + cellW / 2, y + rowH / 2 - 1, { align: "center" });
        doc.setFont("helvetica", "normal").setFontSize(7).text(`#${rank + 1}`, cx + cellW / 2, y + rowH / 2 + 10, { align: "center" });
      });
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(accent).text(avg === 99 ? "—" : avg.toFixed(1), W - M - 30, y + rowH / 2 + 3, { align: "center" });
      y += rowH;
    }
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED)
      .text("Ranked by average standing across the selected metrics. Green = top third, red = bottom third.", M, H - 40);
  }

  // ---------------------------------------------------------- ranking charts
  if (req.charts.ranking) {
    for (const m of metrics) {
      const pts = ranked(m);
      if (!pts.length) continue;
      const y0 = page(m.label, m.description);
      const railW = 210;
      const rx = W - M - railW;
      const chartX = M + 70;
      const labelSpace = 52; // room for the value label that sits at the bar tip
      const chartW = rx - 20 - labelSpace - chartX;
      const max = Math.max(...pts.map((p) => p.value));
      const min = Math.min(0, ...pts.map((p) => p.value));
      const span = max - min || 1;
      const avail = H - y0 - 56;
      const pitch = avail / pts.length;
      const barH = Math.max(14, Math.min(40, pitch - 12));
      let by = y0;
      // gridlines
      doc.setDrawColor("#EDF1F7").setLineWidth(0.6);
      for (let g = 0; g <= 4; g++) doc.line(chartX + (chartW * g) / 4, y0 - 8, chartX + (chartW * g) / 4, y0 + pts.length * pitch - (pitch - barH));
      for (const p of pts) {
        const w = Math.max(((p.value - min) / span) * chartW, 1.5);
        const cy = by + barH / 2 + 3;
        doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK).text(p.bank.ticker, chartX - 10, cy, { align: "right" });
        doc.setFillColor(p.bank.colorHex).roundedRect(chartX, by, w, barH, 2, 2, "F");
        doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK).text(fmt(p.value, m), chartX + w + 8, cy);
        by += pitch;
      }
      // read-across rail — sized to its content rather than the full page height
      const notes = readAcross(m, pts, home);
      doc.setFont("helvetica", "normal").setFontSize(9);
      const wrappedNotes = notes.map((n) => doc.splitTextToSize(n, railW - 34) as string[]);
      const railH = 44 + wrappedNotes.reduce((s, w) => s + w.length * 12 + 8, 0);
      doc.setFillColor(PANEL).roundedRect(rx, y0 - 14, railW, railH, 4, 4, "F");
      doc.setDrawColor(RULE).setLineWidth(0.7).roundedRect(rx, y0 - 14, railW, railH, 4, 4, "S");
      doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(accent).text("READ-ACROSS", rx + 14, y0 + 6);
      let ny = y0 + 30;
      doc.setFont("helvetica", "normal").setFontSize(9);
      for (const wrapped of wrappedNotes) {
        doc.setFillColor(accent).circle(rx + 15, ny - 3, 1.8, "F");
        doc.setTextColor(BODY).text(wrapped, rx + 24, ny);
        ny += wrapped.length * 12 + 8;
      }
    }
  }

  // ------------------------------------------------------------ trend charts
  if (req.charts.trend) {
    const periods = periodsOf(sel, req.period);
    for (const m of metrics) {
      const series = sel
        .map((b) => ({ bank: b, values: periods.map((p) => valueOf(b, m.key, p)) }))
        .filter((s) => s.values.some((v) => v != null));
      const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
      if (!all.length || periods.length < 2) continue;
      const y0 = page(`${m.label} — trend`, `${periods[0]} to ${periods[periods.length - 1]}`);
      const plotX = M + 52, plotW = W - 2 * M - 72, plotY = y0, plotH = H - y0 - 96;
      const lo = Math.min(...all), hi = Math.max(...all);
      const pad = (hi - lo || 1) * 0.15;
      const yMin = lo - pad, yMax = hi + pad;
      const px = (i: number) => plotX + (plotW * i) / (periods.length - 1);
      const py = (v: number) => plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
      // grid + value axis
      doc.setDrawColor("#EDF1F7").setLineWidth(0.6);
      for (let g = 0; g <= 4; g++) {
        const gy = plotY + (plotH * g) / 4;
        doc.line(plotX, gy, plotX + plotW, gy);
        doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(MUTED)
          .text(fmt(yMax - ((yMax - yMin) * g) / 4, m), plotX - 8, gy + 3, { align: "right" });
      }
      // period axis
      periods.forEach((p, i) => {
        if (periods.length > 8 && i % 2 === 1) return;
        doc.setFontSize(7.5).setTextColor(MUTED).text(p, px(i), plotY + plotH + 16, { align: "center" });
      });
      // series
      doc.setLineWidth(1.6);
      for (const s of series) {
        doc.setDrawColor(s.bank.colorHex).setFillColor(s.bank.colorHex);
        let prev: { x: number; y: number } | null = null;
        s.values.forEach((v, i) => {
          if (v == null) { prev = null; return; }
          const pt = { x: px(i), y: py(v) };
          if (prev) doc.line(prev.x, prev.y, pt.x, pt.y);
          doc.circle(pt.x, pt.y, 2, "F");
          prev = pt;
        });
      }
      // legend
      let lx = plotX;
      const ly = plotY + plotH + 38;
      for (const s of series) {
        doc.setFillColor(s.bank.colorHex).rect(lx, ly - 6, 9, 3, "F");
        doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(BODY).text(s.bank.ticker, lx + 14, ly);
        lx += 14 + doc.getTextWidth(s.bank.ticker) + 20;
      }
      const movers = series
        .map((s) => {
          const first = s.values.find((v) => v != null);
          const last = [...s.values].reverse().find((v) => v != null);
          return { name: s.bank.ticker, delta: first != null && last != null ? last - first : null };
        })
        .filter((x) => x.delta != null)
        .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));
      if (movers.length)
        doc.setFontSize(8.5).setTextColor(MUTED).text(
          `Largest move over the window: ${movers[0].name} ${(movers[0].delta as number) >= 0 ? "+" : ""}${(movers[0].delta as number).toFixed(m.decimals)}${m.unit === "%" ? "pp" : ""}.`,
          M, H - 40
        );
    }
  }

  // ----------------------------------------------------------------- sources
  {
    let y = page("Sources & methodology", "Every figure traces to the institution's own published disclosure");
    doc.setFillColor(accent).rect(M, y - 15, W - 2 * M, 22, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#FFFFFF").text("Institution", M + 8, y);
    doc.text("Primary source for this period", M + 220, y);
    y += 26;
    doc.setFont("helvetica", "normal");
    sel.forEach((b, i) => {
      const q = b.quarters.find((x) => x.period === req.period);
      if (i % 2 === 1) doc.setFillColor(PANEL).rect(M, y - 12, W - 2 * M, 20, "F");
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK).text(b.bankName, M + 8, y);
      doc.setFont("helvetica", "normal").setTextColor(BODY).text(q?.reportName ?? "Quarterly disclosure", M + 220, y);
      y += 22;
    });
    y += 16;
    const notes = [
      "Figures are taken from each bank's own quarterly Report to Shareholders, supplementary financial information or regulatory disclosure — not third-party aggregators.",
      "Rankings are direction-aware: for efficiency ratio and risk-sensitivity measures, a lower value ranks better.",
      "Ratios we compute (rather than quote) are noted as such in the dashboard's data-lineage view, where each figure links to the page it appears on.",
    ];
    doc.setFontSize(9.5);
    for (const n of notes) {
      const wrapped = doc.splitTextToSize(n, W - 2 * M - 16) as string[];
      doc.setFillColor(accent).circle(M + 3, y - 3.5, 2, "F");
      doc.setTextColor(BODY).text(wrapped, M + 14, y);
      y += wrapped.length * 12 + 8;
    }
  }

  // -------------------------------------------------- footer + page numbers
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text(`${req.title}  ·  ${req.period}`, M, H - 22);
    doc.text(`${p - 1} / ${total - 1}`, W - M, H - 22, { align: "right" });
  }

  return doc.output("blob");
}
