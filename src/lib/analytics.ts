import type { BankData, MetricKey, QuarterMetrics } from "@/types/metrics";

export interface SeriesPoint {
  period: string;
  periodEnd: string;
  value: number | null;
}

export function getMetricSeries(bank: BankData, key: MetricKey): SeriesPoint[] {
  return bank.quarters.map((q) => ({
    period: q.period,
    periodEnd: q.periodEnd,
    value: q.metrics[key] ?? null,
  }));
}

export function latestQuarterWith(bank: BankData, key: MetricKey): QuarterMetrics | undefined {
  for (let i = bank.quarters.length - 1; i >= 0; i--) {
    if (bank.quarters[i].metrics[key] != null) return bank.quarters[i];
  }
  return undefined;
}

export function latestQuarter(bank: BankData): QuarterMetrics | undefined {
  return bank.quarters[bank.quarters.length - 1];
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[], m: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export interface QoQChange {
  metric: MetricKey;
  bankId: string;
  period: string;
  previousPeriod: string;
  value: number;
  previousValue: number;
  delta: number;
  deltaPct: number | null; // relative % change, null if base is 0
}

export function computeQoQChanges(bank: BankData, key: MetricKey): QoQChange[] {
  const series = getMetricSeries(bank, key);
  const changes: QoQChange[] = [];
  for (let i = 1; i < series.length; i++) {
    const cur = series[i];
    const prev = series[i - 1];
    if (cur.value == null || prev.value == null) continue;
    const delta = cur.value - prev.value;
    changes.push({
      metric: key,
      bankId: bank.bankId,
      period: cur.period,
      previousPeriod: prev.period,
      value: cur.value,
      previousValue: prev.value,
      delta,
      deltaPct: prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : null,
    });
  }
  return changes;
}

export interface TimeSeriesAnomaly extends QoQChange {
  bankName: string;
  zScore: number;
  severity: "watch" | "alert";
}

/**
 * Flags quarter-over-quarter moves that are unusually large relative to a
 * bank-metric's own historical volatility (z-score of the delta series).
 */
export function detectTimeSeriesAnomalies(
  banks: BankData[],
  key: MetricKey,
  { watchZ = 1.5, alertZ = 2.25, minAbsDelta = 0 }: { watchZ?: number; alertZ?: number; minAbsDelta?: number } = {}
): TimeSeriesAnomaly[] {
  const anomalies: TimeSeriesAnomaly[] = [];
  for (const bank of banks) {
    const changes = computeQoQChanges(bank, key);
    if (changes.length < 3) continue;
    const deltas = changes.map((c) => c.delta);
    const m = mean(deltas);
    const sd = stdev(deltas, m);
    if (sd === 0) continue;
    for (const c of changes) {
      const z = (c.delta - m) / sd;
      const absZ = Math.abs(z);
      if (absZ >= watchZ && Math.abs(c.delta) >= minAbsDelta) {
        anomalies.push({
          ...c,
          bankName: bank.bankName,
          zScore: z,
          severity: absZ >= alertZ ? "alert" : "watch",
        });
      }
    }
  }
  return anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

export interface PeerOutlier {
  metric: MetricKey;
  period: string;
  bankId: string;
  bankName: string;
  value: number;
  peerMean: number;
  zScore: number;
  belowRegMinimum: boolean;
}

/**
 * Flags banks whose latest-quarter value for a metric deviates sharply from
 * the peer group mean for that same period (cross-sectional outlier detection).
 */
export function detectPeerOutliers(
  banks: BankData[],
  key: MetricKey,
  period: string,
  {
    z = 1.5,
    regulatoryMinimum,
    baselineExcludeBankId,
  }: { z?: number; regulatoryMinimum?: number; baselineExcludeBankId?: string } = {}
): PeerOutlier[] {
  const points = banks
    .map((b) => {
      const q = b.quarters.find((q) => q.period === period);
      const value = q?.metrics[key];
      return value != null ? { bankId: b.bankId, bankName: b.bankName, value } : null;
    })
    .filter((p): p is { bankId: string; bankName: string; value: number } => p !== null);

  if (points.length < 3) return [];

  // The comparator is the PEER group. `baselineExcludeBankId` drops the home institution
  // from the mean and standard deviation so it is scored AGAINST its peers rather than
  // against a group it is itself a member of -- otherwise a bank that is far from the
  // others drags the baseline toward itself and shrinks its own z-score. Every bank is
  // still scored; only the baseline changes.
  const baseline = points.filter((p) => p.bankId !== baselineExcludeBankId);
  if (baseline.length < 3) return [];

  const values = baseline.map((p) => p.value);
  const m = mean(values);
  const sd = stdev(values, m);
  if (sd === 0) return [];

  return points
    .map((p) => ({
      metric: key,
      period,
      bankId: p.bankId,
      bankName: p.bankName,
      value: p.value,
      peerMean: m,
      zScore: (p.value - m) / sd,
      belowRegMinimum: regulatoryMinimum != null ? p.value < regulatoryMinimum : false,
    }))
    .filter((o) => Math.abs(o.zScore) >= z || o.belowRegMinimum)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

export function peerAverage(banks: BankData[], key: MetricKey, period: string, excludeBankId?: string): number | null {
  const values = banks
    .filter((b) => b.bankId !== excludeBankId)
    .map((b) => b.quarters.find((q) => q.period === period)?.metrics[key])
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return mean(values);
}

export function formatMetricValue(value: number | null | undefined, unit: string, decimals: number): string {
  if (value == null) return "—";
  if (unit === "$B") return `$${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}B`;
  if (unit === "$M") return `$${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}M`;
  return `${value.toFixed(decimals)}%`;
}
