"use client";

import Papa from "papaparse";
import { toPng } from "html-to-image";
import type { BankData, MetricKey, MetricMeta } from "@/types/metrics";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Exports the full raw dataset (every bank, quarter, and metric) as a flat CSV,
 * including the source report name/URL per row so the export doubles as an
 * auditable data trail.
 */
export function exportRawCsv(banks: BankData[], metrics: MetricMeta[]) {
  const rows: Record<string, string | number>[] = [];
  for (const bank of banks) {
    for (const q of bank.quarters) {
      const row: Record<string, string | number> = {
        bank: bank.bankName,
        ticker: bank.ticker,
        period: q.period,
        periodEnd: q.periodEnd,
        reportName: q.reportName,
        reportUrl: q.reportUrl,
        supplementaryReportName: q.supplementaryReportName ?? "",
        supplementaryReportUrl: q.supplementaryReportUrl ?? "",
        retrievedAt: q.retrievedAt,
      };
      for (const m of metrics) {
        row[m.shortLabel] = q.metrics[m.key] ?? "";
      }
      rows.push(row);
    }
  }
  const csv = Papa.unparse(rows);
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `rbc-treasury-benchmarking-raw-${Date.now()}.csv`);
}

/**
 * Exports a single metric's time series across all banks as a wide CSV
 * (one column per bank), convenient for pivoting into a deck chart.
 */
export function exportMetricCsv(banks: BankData[], key: MetricKey, periods: string[]) {
  const rows = periods.map((period) => {
    const row: Record<string, string | number> = { period };
    for (const bank of banks) {
      const q = bank.quarters.find((q) => q.period === period);
      row[bank.bankName] = q?.metrics[key] ?? "";
    }
    return row;
  });
  const csv = Papa.unparse(rows);
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${key}-${Date.now()}.csv`);
}

export async function exportChartAsPng(node: HTMLElement, filename: string) {
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#070c16",
  });
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  download(blob, filename);
}
