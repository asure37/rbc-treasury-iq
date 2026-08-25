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

// ---------------------------------------------------------------------------
// Peer-comparison block: metrics down the side, banks across the top, and a
// second block of the same shape carrying the quarter-over-quarter change.
// Mirrors the layout of the analyst worksheet this was modelled on.
// ---------------------------------------------------------------------------

/** Column order and headings, matching the worksheet rather than the dataset's own order. */
const PEER_COMP_BANKS: { bankId: string; heading: string }[] = [
  { bankId: "rbc", heading: "RBC" },
  { bankId: "bmo", heading: "BMO" },
  { bankId: "scotia", heading: "BNS" },
  { bankId: "cibc", heading: "CIBC" },
  { bankId: "td", heading: "TD" },
  { bankId: "national", heading: "NA" },
];

/**
 * One row of the block. `value` pulls the figure for a given quarter, so a row can be
 * a stored metric or something derived from several (AT1 and Tier 2 are published only
 * as capital tiers, never as their own ratios -- each is the gap between two ratios).
 */
interface PeerCompRow {
  label: string;
  decimals: number;
  value: (m: Partial<Record<MetricKey, number | null>>) => number | null;
}

const PEER_COMP_ROWS: PeerCompRow[] = [
  { label: "Total Assets (C$MM)", decimals: 0, value: (m) => (m.totalAssetsBillions != null ? m.totalAssetsBillions * 1000 : null) },
  { label: "Total RWA (C$MM)", decimals: 0, value: (m) => m.riskWeightedAssetsMillions ?? null },
  { label: "ROE (adjusted)", decimals: 2, value: (m) => m.roe ?? null },
  { label: "CET1", decimals: 2, value: (m) => m.cet1Ratio ?? null },
  { label: "Tier 1", decimals: 2, value: (m) => m.tier1CapitalRatio ?? null },
  { label: "Total capital ratio", decimals: 2, value: (m) => m.totalCapitalRatio ?? null },
  { label: "Leverage ratio", decimals: 2, value: (m) => m.leverageRatio ?? null },
  { label: "TLAC", decimals: 2, value: (m) => m.tlacRatio ?? null },
  { label: "TLAC Leverage", decimals: 2, value: (m) => m.tlacLeverageRatio ?? null },
  { label: "LCR", decimals: 2, value: (m) => m.lcr ?? null },
  { label: "NSFR", decimals: 2, value: (m) => m.nsfr ?? null },
  // AT1 and Tier 2 are the gaps between successive capital ratios. Neither is published
  // as a ratio in its own right, but both reproduce the worksheet exactly.
  {
    label: "AT1",
    decimals: 2,
    value: (m) => (m.tier1CapitalRatio != null && m.cet1Ratio != null ? m.tier1CapitalRatio - m.cet1Ratio : null),
  },
  {
    label: "T2",
    decimals: 2,
    value: (m) =>
      m.totalCapitalRatio != null && m.tier1CapitalRatio != null ? m.totalCapitalRatio - m.tier1CapitalRatio : null,
  },
];

/** The quarter immediately before `period` in the dataset's own ordering, if any. */
function priorPeriod(banks: BankData[], period: string): string | null {
  const ordered = Array.from(
    new Map(banks.flatMap((b) => b.quarters.map((q) => [q.period, q.periodEnd] as const))).entries()
  )
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([p]) => p);
  const i = ordered.indexOf(period);
  return i > 0 ? ordered[i - 1] : null;
}

/** Spreadsheet column letter for a 0-based index (0 -> A, 26 -> AA). */
function colLetter(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/**
 * Peer-comparison CSV for a single quarter, laid out banks-across-the-top: the
 * quarter's values, the prior quarter's values, then the change between them.
 *
 * The delta cells are written as spreadsheet FORMULAS (=B3-J3), not baked numbers, so
 * they stay live: correct a figure in either block and the delta follows. That is also
 * why the prior quarter gets its own block rather than being folded away -- a formula
 * needs both operands present on the sheet to subtract.
 *
 * Values are unformatted (no thousands separators, no % sign) so they arrive as numbers
 * rather than text; the units live in the row labels, as on the source worksheet. A
 * blank means the bank has not reported that quarter, and a delta whose operands are
 * not both present is left blank rather than formula-ing against an empty cell.
 */
export function exportPeerCompCsv(banks: BankData[], period: string) {
  const prior = priorPeriod(banks, period);
  const cols = PEER_COMP_BANKS.map((c) => ({ ...c, bank: banks.find((b) => b.bankId === c.bankId) })).filter(
    (c) => c.bank
  );
  const n = cols.length;

  const metricsFor = (bankId: string | undefined, p: string | null) => {
    if (!bankId || !p) return {} as Partial<Record<MetricKey, number | null>>;
    const bank = banks.find((b) => b.bankId === bankId);
    return bank?.quarters.find((q) => q.period === p)?.metrics ?? {};
  };
  const fmt = (v: number | null, decimals: number) => (v == null ? "" : v.toFixed(decimals));

  // Column layout: A label | B.. current | spacer | prior | spacer | deltas
  const CUR0 = 1;
  const PRIOR0 = CUR0 + n + 1;

  const blank = (count: number) => Array(count).fill("");
  const rows: string[][] = [];
  rows.push([
    period, ...blank(n), "",
    prior ? `${prior} (prior)` : "(no prior quarter)", ...blank(n - 1), "",
    prior ? `Deltas (${period} less ${prior})` : "Deltas", ...blank(n - 1),
  ]);
  rows.push([
    "", ...cols.map((c) => c.heading), "",
    ...cols.map((c) => c.heading), "",
    ...cols.map((c) => c.heading),
  ]);

  PEER_COMP_ROWS.forEach((row, ri) => {
    const excelRow = ri + 3; // two header rows above
    const cur = cols.map((c) => row.value(metricsFor(c.bankId, period)));
    const prev = cols.map((c) => row.value(metricsFor(c.bankId, prior)));
    const deltas = cur.map((v, i) =>
      v != null && prev[i] != null ? `=${colLetter(CUR0 + i)}${excelRow}-${colLetter(PRIOR0 + i)}${excelRow}` : ""
    );
    rows.push([
      row.label,
      ...cur.map((v) => fmt(v, row.decimals)), "",
      ...prev.map((v) => fmt(v, row.decimals)), "",
      ...deltas,
    ]);
  });

  const csv = Papa.unparse(rows);
  download(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `peer-comparison-${period.replace(/\s+/g, "-")}.csv`
  );
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
