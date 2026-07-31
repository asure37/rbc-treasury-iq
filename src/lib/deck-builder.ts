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

// ---------------------------------------------------------------- PowerPoint
export async function buildPptx(req: DeckRequest, banks: BankData[], meta: MetricMeta[]): Promise<Blob> {
  const sel = banks.filter((b) => req.bankIds.includes(b.bankId));
  const metrics = meta.filter((m) => req.metricKeys.includes(m.key));
  const dark = req.theme === "dark";
  const bg = dark ? "0C1424" : "FFFFFF";
  const fg = dark ? "EEF4FC" : "1A2233";
  const muted = dark ? "A8BBD6" : "5A6B85";
  const accent = hex(req.accent || RBC_BLUE);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.3 x 7.5 in
  pptx.defineSlideMaster({
    title: "TIQ",
    background: { color: bg },
    objects: [{ text: { text: "RBC Treasury Intelligence", options: { x: 0.5, y: 6.95, w: 6, h: 0.3, fontSize: 9, color: muted } } }],
  });

  // Title slide
  const t = pptx.addSlide({ masterName: "TIQ" });
  t.addText(req.title, { x: 0.8, y: 2.5, w: 11.7, h: 1, fontSize: 40, bold: true, color: fg, fontFace: "Calibri" });
  t.addText(req.subtitle, { x: 0.8, y: 3.5, w: 11.7, h: 0.5, fontSize: 16, color: muted, fontFace: "Calibri" });
  t.addText(`${sel.map((b) => b.ticker).join(" · ")}  |  ${req.period}`, {
    x: 0.8, y: 4.1, w: 11.7, h: 0.4, fontSize: 12, color: accent, fontFace: "Calibri",
  });

  // Summary table
  if (req.charts.table) {
    const s = pptx.addSlide({ masterName: "TIQ" });
    s.addText(`Peer comparison — ${req.period}`, { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg });
    const head = [{ text: "Metric", options: { bold: true, color: "FFFFFF", fill: { color: accent } } },
      ...sel.map((b) => ({ text: b.ticker, options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: "center" as const } }))];
    const rows = metrics.map((m) => [
      { text: m.shortLabel, options: { color: fg, bold: true } },
      ...sel.map((b) => ({ text: fmt(valueOf(b, m.key, req.period), m), options: { color: fg, align: "center" as const } })),
    ]);
    s.addTable([head, ...rows], {
      x: 0.5, y: 1.0, w: 12.3, fontSize: 11, fontFace: "Calibri", border: { type: "solid", pt: 0.5, color: dark ? "27364F" : "DDE3ED" },
      fill: { color: dark ? "121D33" : "F7F9FC" },
    });
  }

  // One ranking chart per metric
  if (req.charts.ranking) {
    for (const m of metrics) {
      const pts = sel
        .map((b) => ({ name: b.ticker, value: valueOf(b, m.key, req.period) }))
        .filter((p): p is { name: string; value: number } => p.value != null)
        .sort((a, b) => (m.higherIsBetter === false ? a.value - b.value : b.value - a.value));
      if (!pts.length) continue;
      const s = pptx.addSlide({ masterName: "TIQ" });
      s.addText(`${m.label} — ${req.period}`, { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg });
      s.addText(m.description ?? "", { x: 0.5, y: 0.85, w: 12.3, h: 0.4, fontSize: 10, color: muted });
      s.addChart(
        pptx.ChartType.bar,
        [{ name: m.shortLabel, labels: pts.map((p) => p.name), values: pts.map((p) => p.value) }],
        {
          x: 0.6, y: 1.4, w: 12.1, h: 4.9, barDir: "bar", showValue: true, dataLabelPosition: "outEnd",
          chartColors: [accent], catAxisLabelColor: muted, valAxisLabelColor: muted,
          valGridLine: { color: dark ? "27364F" : "E6EBF3", size: 1 }, catGridLine: { style: "none" },
          showLegend: false, showTitle: false, dataLabelFormatCode: m.unit === "%" ? `0.${"0".repeat(m.decimals)}"%"` : "#,##0",
        }
      );
    }
  }

  // Trend chart per metric
  if (req.charts.trend) {
    const periods = periodsOf(sel, req.period);
    for (const m of metrics) {
      const series = sel
        .map((b) => ({ name: b.ticker, labels: periods, values: periods.map((p) => valueOf(b, m.key, p) ?? null) }))
        .filter((s) => s.values.some((v) => v != null));
      if (!series.length) continue;
      const s = pptx.addSlide({ masterName: "TIQ" });
      s.addText(`${m.label} — trend`, { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg });
      s.addChart(pptx.ChartType.line, series as never, {
        x: 0.6, y: 1.1, w: 12.1, h: 5.2, chartColors: sel.map((b) => hex(b.colorHex)),
        catAxisLabelColor: muted, valAxisLabelColor: muted, valGridLine: { color: dark ? "27364F" : "E6EBF3", size: 1 },
        catGridLine: { style: "none" }, showLegend: true, legendPos: "b", legendColor: muted, showTitle: false, lineSmooth: false,
      });
    }
  }

  // Rank heat map (values + rank per metric)
  if (req.charts.heatmap) {
    const s = pptx.addSlide({ masterName: "TIQ" });
    s.addText(`Competitive standing — ${req.period}`, { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg });
    const head = [{ text: "Institution", options: { bold: true, color: "FFFFFF", fill: { color: accent } } },
      ...metrics.map((m) => ({ text: m.shortLabel, options: { bold: true, color: "FFFFFF", fill: { color: accent }, align: "center" as const } }))];
    const ranked = sel.map((b) => {
      const cells = metrics.map((m) => {
        const vals = sel.map((x) => valueOf(x, m.key, req.period)).filter((v): v is number => v != null);
        const v = valueOf(b, m.key, req.period);
        if (v == null) return { text: "—", options: { align: "center" as const, color: muted } };
        const sorted = [...vals].sort((x, y) => (m.higherIsBetter === false ? x - y : y - x));
        const rank = sorted.indexOf(v) + 1;
        const good = rank <= Math.ceil(sorted.length / 3);
        const bad = rank > sorted.length - Math.ceil(sorted.length / 3);
        return {
          text: `${fmt(v, m)}  #${rank}`,
          options: { align: "center" as const, color: fg, fill: { color: good ? "1F6F4A" : bad ? "7A2230" : dark ? "121D33" : "F0F3F8" } },
        };
      });
      return [{ text: b.ticker, options: { bold: true, color: fg } }, ...cells];
    });
    s.addTable([head, ...ranked], {
      x: 0.5, y: 1.0, w: 12.3, fontSize: 10, fontFace: "Calibri",
      border: { type: "solid", pt: 0.5, color: dark ? "27364F" : "DDE3ED" },
    });
  }

  // Sources / methodology
  const src = pptx.addSlide({ masterName: "TIQ" });
  src.addText("Sources & methodology", { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontSize: 22, bold: true, color: fg });
  const lines = sel.map((b) => {
    const q = b.quarters.find((x) => x.period === req.period);
    return `${b.bankName} — ${q?.reportName ?? "quarterly disclosure"}`;
  });
  src.addText(
    [
      { text: "Every figure is taken from the institution's own published disclosure and is traceable to the page it appears on.", options: { fontSize: 12, color: fg, breakLine: true } },
      ...lines.map((l) => ({ text: l, options: { fontSize: 11, color: muted, bullet: true, breakLine: true } })),
    ],
    { x: 0.6, y: 1.1, w: 12.1, h: 5 }
  );

  return (await pptx.write({ outputType: "blob" })) as Blob;
}

// ---------------------------------------------------------------------- PDF
export function buildPdf(req: DeckRequest, banks: BankData[], meta: MetricMeta[]): Blob {
  const sel = banks.filter((b) => req.bankIds.includes(b.bankId));
  const metrics = meta.filter((m) => req.metricKeys.includes(m.key));
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const accent = req.accent || `#${RBC_BLUE}`;

  // cover
  doc.setFillColor(accent);
  doc.rect(0, 0, W, 8, "F");
  doc.setFontSize(28).setTextColor("#12203a").text(req.title, 48, 140);
  doc.setFontSize(13).setTextColor("#5A6B85").text(req.subtitle, 48, 168);
  doc.setFontSize(11).setTextColor(accent).text(`${sel.map((b) => b.ticker).join("  ·  ")}    |    ${req.period}`, 48, 196);
  if (req.instructions.trim()) {
    doc.setFontSize(9).setTextColor("#7A8AA3");
    doc.text(doc.splitTextToSize(`Prepared to instruction: ${req.instructions.trim()}`, W - 96), 48, 228);
  }

  // comparison table
  doc.addPage();
  doc.setFontSize(16).setTextColor("#12203a").text(`Peer comparison — ${req.period}`, 40, 48);
  const colW = (W - 200) / Math.max(sel.length, 1);
  let y = 80;
  doc.setFillColor(accent);
  doc.rect(40, y - 16, W - 80, 22, "F");
  doc.setFontSize(10).setTextColor("#FFFFFF").text("Metric", 46, y);
  sel.forEach((b, i) => doc.text(b.ticker, 200 + i * colW, y, { align: "center" }));
  y += 24;
  doc.setTextColor("#1A2233");
  for (const m of metrics) {
    if (y > H - 40) { doc.addPage(); y = 60; }
    doc.setFontSize(9).setTextColor("#12203a").text(m.shortLabel, 46, y);
    sel.forEach((b, i) => {
      doc.setTextColor("#33405A").text(fmt(valueOf(b, m.key, req.period), m), 200 + i * colW, y, { align: "center" });
    });
    doc.setDrawColor("#E6EBF3").line(40, y + 6, W - 40, y + 6);
    y += 22;
  }

  // one bar chart page per metric
  if (req.charts.ranking) {
    for (const m of metrics) {
      const pts = sel
        .map((b) => ({ name: b.ticker, value: valueOf(b, m.key, req.period), color: b.colorHex }))
        .filter((p): p is { name: string; value: number; color: string } => p.value != null)
        .sort((a, b) => (m.higherIsBetter === false ? a.value - b.value : b.value - a.value));
      if (!pts.length) continue;
      doc.addPage();
      doc.setFontSize(16).setTextColor("#12203a").text(`${m.label} — ${req.period}`, 40, 48);
      doc.setFontSize(9).setTextColor("#5A6B85").text(doc.splitTextToSize(m.description ?? "", W - 80), 40, 68);
      const max = Math.max(...pts.map((p) => p.value));
      const min = Math.min(0, ...pts.map((p) => p.value));
      const span = max - min || 1;
      const chartX = 140, chartW = W - 220;
      let by = 110;
      const barH = Math.min(34, (H - 170) / pts.length - 10);
      for (const p of pts) {
        const w = ((p.value - min) / span) * chartW;
        doc.setFontSize(10).setTextColor("#12203a").text(p.name, chartX - 12, by + barH / 2 + 3, { align: "right" });
        doc.setFillColor(p.color);
        doc.rect(chartX, by, Math.max(w, 1), barH, "F");
        doc.setTextColor("#12203a").text(fmt(p.value, m), chartX + Math.max(w, 1) + 8, by + barH / 2 + 3);
        by += barH + 10;
      }
    }
  }

  // sources
  doc.addPage();
  doc.setFontSize(16).setTextColor("#12203a").text("Sources & methodology", 40, 48);
  let sy = 80;
  doc.setFontSize(10).setTextColor("#33405A");
  doc.text(doc.splitTextToSize("Every figure is taken from the institution's own published disclosure and is traceable to the page it appears on.", W - 80), 40, sy);
  sy += 30;
  for (const b of sel) {
    const q = b.quarters.find((x) => x.period === req.period);
    doc.setFontSize(9).setTextColor("#5A6B85").text(`• ${b.bankName} — ${q?.reportName ?? "quarterly disclosure"}`, 46, sy);
    sy += 18;
    if (sy > H - 40) { doc.addPage(); sy = 60; }
  }

  return doc.output("blob");
}
