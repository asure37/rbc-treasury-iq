import type { MetricKey } from "@/types/metrics";

// All six banks have an October 31 fiscal year-end, so fiscal quarters map to
// fixed calendar month-ends within the label year:
//   Q1 -> Jan 31, Q2 -> Apr 30, Q3 -> Jul 31, Q4 -> Oct 31.
const QUARTER_END = { 1: "01-31", 2: "04-30", 3: "07-31", 4: "10-31" } as const;

export interface QuarterId {
  period: string; // "Q3 2026"
  periodEnd: string; // "2026-07-31"
  quarter: 1 | 2 | 3 | 4;
  year: number;
}

export function parsePeriod(period: string): { quarter: 1 | 2 | 3 | 4; year: number } | null {
  const m = period.match(/^Q([1-4])\s+(\d{4})$/);
  if (!m) return null;
  return { quarter: Number(m[1]) as 1 | 2 | 3 | 4, year: Number(m[2]) };
}

export function makeQuarterId(quarter: 1 | 2 | 3 | 4, year: number): QuarterId {
  return { period: `Q${quarter} ${year}`, periodEnd: `${year}-${QUARTER_END[quarter]}`, quarter, year };
}

// Given the most recent period we hold, return the next fiscal quarter.
export function getNextQuarter(latestPeriod: string): QuarterId | null {
  const parsed = parsePeriod(latestPeriod);
  if (!parsed) return null;
  if (parsed.quarter === 4) return makeQuarterId(1, parsed.year + 1);
  return makeQuarterId((parsed.quarter + 1) as 1 | 2 | 3 | 4, parsed.year);
}

// Canadian D-SIBs typically report ~4 weeks after quarter end. We use a
// deliberately conservative 20-day threshold so we never skip a quarter that
// might genuinely be out — worst case we invoke the (slower) live extraction
// for a quarter that turns out not to be filed yet.
export function isLikelyReported(q: QuarterId, asOf: Date = new Date()): boolean {
  const end = new Date(`${q.periodEnd}T00:00:00Z`);
  const reportedBy = new Date(end);
  reportedBy.setDate(reportedBy.getDate() + 20);
  return asOf >= reportedBy;
}

// Friendly "expected around…" date (quarter end + ~4 weeks) for messaging when
// a quarter isn't out yet.
export function expectedReportDate(q: QuarterId): string {
  const end = new Date(`${q.periodEnd}T00:00:00Z`);
  end.setDate(end.getDate() + 28);
  return end.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

export type SanityFlag = "ok" | "large-move" | "missing" | "out-of-range";

export interface MetricCheck {
  sanity: SanityFlag;
  sourceVerified: boolean | null; // null = not checked (e.g. non-PDF source)
  detail?: string;
}

export interface ProposedQuarter {
  bankId: string;
  bankName: string;
  ticker: string;
  targetPeriod: string;
  periodEnd: string;
  status: "proposed" | "not-available" | "error";
  message?: string;
  reportName?: string;
  reportUrl?: string;
  metrics: Partial<Record<MetricKey, number | null>>;
  notes: Partial<Record<MetricKey, string>>;
  checks: Partial<Record<MetricKey, MetricCheck>>;
}
