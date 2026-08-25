"use client";

import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { useDashboardData } from "@/lib/data-context";
import { useDashboardStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import type { MetricKey, MetricMeta } from "@/types/metrics";

// Grouped set of headline metrics with an unambiguous "better" direction, so ranking is meaningful.
const GROUPS: { label: string; accent: string; keys: MetricKey[] }[] = [
  { label: "Capital", accent: "#0066cc", keys: ["cet1Ratio", "dividendPayoutRatio", "leverageRatio", "tlacRatio"] },
  { label: "Liquidity", accent: "#00b6f1", keys: ["lcr", "nsfr"] },
  { label: "Profitability", accent: "#ffc72c", keys: ["roe", "roa", "nim", "efficiencyRatio"] },
];
const KEYS: MetricKey[] = GROUPS.flatMap((g) => g.keys);

// Diverging heat scale: t=0 (rank 1 / best) = teal → 0.5 = amber → 1 (worst) = rose.
function heatRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const a: [number, number, number] = x < 0.5 ? [45, 212, 191] : [251, 191, 36];
  const b: [number, number, number] = x < 0.5 ? [251, 191, 36] : [251, 113, 133];
  const lt = x < 0.5 ? x / 0.5 : (x - 0.5) / 0.5;
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * lt)) as unknown as [number, number, number];
}

const fmtVal = (v: number, m: MetricMeta) =>
  `${m.unit === "$" ? "$" : ""}${v.toFixed(m.decimals)}${m.unit === "%" ? "%" : m.unit === "x" ? "x" : ""}`;

interface Cell {
  key: MetricKey;
  value: number | null;
  rank: number | null;
  total: number;
  /** Issuer does not publish this metric; the value was computed from ones it does. */
  derived: boolean;
  /** Issuer discloses no adjusted figure for this metric; the value shown is reported/as-disclosed. */
  offBasis: boolean;
}

export function RankHeatmap() {
  const { banks, metricsMeta, periods } = useDashboardData();
  const setFocusMetric = useDashboardStore((s) => s.setFocusMetric);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);

  const latestPeriod = periods[periods.length - 1]?.period;
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const period = selectedPeriod ?? latestPeriod;
  const isLatest = period === latestPeriod;
  const periodsNewestFirst = [...periods].reverse();

  // Which metrics are hidden. Empty set = show all (the default).
  const [hiddenKeys, setHiddenKeys] = useState<Set<MetricKey>>(new Set());

  // Stagger the row entrance only on first mount — after the intro plays, disable it so filter/period
  // changes don't re-trigger the animation and make rows flicker as they reorder.
  const [introAnim, setIntroAnim] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntroAnim(false), 600);
    return () => clearTimeout(t);
  }, []);

  const { rows, metaByKey, visibleKeys, visibleGroups } = useMemo(() => {
    const metaByKey = new Map<MetricKey, MetricMeta>(metricsMeta.map((m) => [m.key, m]));
    const rankOf: Record<string, Record<string, Cell>> = {};

    // Rank every metric column (rank within a column is independent of what's shown).
    for (const key of KEYS) {
      const meta = metaByKey.get(key)!;
      const vals = banks.map((b) => {
        const q = b.quarters.find((qq) => qq.period === period);
        return {
          id: b.bankId,
          v: q?.metrics[key] ?? null,
          derived: q?.derived?.[key] === true,
          offBasis: q?.offBasis?.[key] === true,
        };
      });
      const present = vals.filter(
        (x): x is { id: string; v: number; derived: boolean; offBasis: boolean } => x.v != null
      );
      // higherIsBetter === false → lowest value ranks first (e.g. efficiency ratio).
      // higherIsBetter === null → no agreed direction (e.g. dividend payout ratio, where a
      // higher payout returns more to shareholders but retains less capital). Such a metric
      // is displayed but never ranked: ordering it would assert a judgement the data does
      // not support, and it would then leak into the row ordering.
      const sorted =
        meta.higherIsBetter === null
          ? []
          : [...present].sort((p, q) => (meta.higherIsBetter === false ? p.v - q.v : q.v - p.v));
      for (const b of banks) {
        const idx = sorted.findIndex((s) => s.id === b.bankId);
        const own = vals.find((x) => x.id === b.bankId)!;
        (rankOf[b.bankId] ??= {})[key] = {
          key,
          value: own.v,
          rank: idx >= 0 ? idx + 1 : null,
          total: sorted.length,
          derived: own.derived,
          offBasis: own.offBasis,
        };
      }
    }

    const visibleKeys = KEYS.filter((k) => !hiddenKeys.has(k));
    const visibleGroups = GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => !hiddenKeys.has(k)) })).filter((g) => g.keys.length > 0);

    // avgRank orders the peer rows only; it is no longer displayed as a column.
    const rows = banks
      .map((bank) => {
        const cells = visibleKeys.map((k) => rankOf[bank.bankId][k]);
        const ranked = cells.filter((c) => c.rank != null);
        const avgRank = ranked.length ? ranked.reduce((s, c) => s + (c.rank as number), 0) / ranked.length : Infinity;
        return { bank, cells, avgRank };
      })
      // The home institution is pinned to the top as the subject of the comparison —
      // it is a reading order, not a standing. Everyone else follows in average-rank
      // order so the table still carries information beyond the per-metric cells.
      .sort((a, b) => {
        if (a.bank.isHomeInstitution !== b.bank.isHomeInstitution) return a.bank.isHomeInstitution ? -1 : 1;
        return a.avgRank - b.avgRank;
      });

    return { rows, metaByKey, visibleKeys, visibleGroups };
  }, [banks, metricsMeta, period, hiddenKeys]);

  const n = rows.length;
  if (!n || !period) return null;


  const goToMetric = (key: MetricKey) => {
    setFocusMetric(key);
    setActiveTab("peers");
  };

  const toggleKey = (key: MetricKey) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (KEYS.length - next.size <= 1) return prev; // always keep at least one metric visible
        next.add(key);
      }
      return next;
    });
  };

  const tableMinWidth = 224 + visibleKeys.length * 86 + (visibleKeys.length + 1) * 4;

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-text-primary">Competitive Standing — Peer Rank Heat Map</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Where each bank ranks across capital, liquidity &amp; profitability. Greener is stronger, redder is weaker.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <select
              value={period ?? ""}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              aria-label="Select quarter"
              className="rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-rbc-cyan/60"
            >
              {periodsNewestFirst.map((p) => (
                <option key={p.period} value={p.period}>
                  {p.period}
                </option>
              ))}
            </select>
            {!isLatest && (
              <button
                onClick={() => setSelectedPeriod(null)}
                className="rounded-full border border-rbc-cyan/30 bg-rbc-cyan/10 px-2.5 py-1 text-xs font-medium text-rbc-cyan transition-colors hover:bg-rbc-cyan/20"
              >
                Latest
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="font-medium text-up">Best</span>
            <div
              className="h-2 w-28 rounded-full ring-1 ring-white/10"
              style={{ background: "linear-gradient(90deg, rgb(45,212,191), rgb(251,191,36), rgb(251,113,133))" }}
            />
            <span className="font-medium text-down">Worst</span>
          </div>
        </div>
      </div>

      {/* Metric picker — toggle any metric off; ranking recomputes on what's shown. Default: all on. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-soft pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Metrics</span>
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5">
            {g.keys.map((k) => {
              const on = !hiddenKeys.has(k);
              return (
                <button
                  key={k}
                  onClick={() => toggleKey(k)}
                  aria-pressed={on}
                  title={`${on ? "Hide" : "Show"} ${metaByKey.get(k)?.label ?? k}`}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                    on ? "text-white" : "border-border-soft bg-surface/40 text-text-muted line-through decoration-1 hover:text-text-secondary"
                  )}
                  style={on ? { background: `${g.accent}22`, borderColor: `${g.accent}80`, color: "#fff" } : undefined}
                >
                  {metaByKey.get(k)?.shortLabel}
                </button>
              );
            })}
          </div>
        ))}
        {hiddenKeys.size > 0 && (
          <button
            onClick={() => setHiddenKeys(new Set())}
            className="ml-auto rounded-full border border-rbc-cyan/30 bg-rbc-cyan/10 px-2.5 py-1 text-[11px] font-medium text-rbc-cyan transition-colors hover:bg-rbc-cyan/20"
          >
            Show all
          </button>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table
          className="w-full table-fixed border-separate border-spacing-1"
          style={{ minWidth: tableMinWidth }}
        >
          <colgroup>
            {/* Institution, then equal-width metric columns. */}
            <col style={{ width: 224 }} />
            {visibleKeys.map((k) => (
              <col key={k} style={{ width: 86 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-20 rounded-lg bg-surface/95 px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wider text-text-muted backdrop-blur"
              >
                Institution
              </th>
              {visibleGroups.map((g) => (
                <th
                  key={g.label}
                  colSpan={g.keys.length}
                  className="px-2 pb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-text-secondary"
                  style={{ borderBottom: `2px solid ${g.accent}` }}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {visibleKeys.map((k) => {
                const m = metaByKey.get(k)!;
                // A metric with no agreed direction gets a dash, not an arrow — an arrow
                // would claim a "better" direction the column is deliberately not ranked on.
                const direction = m.higherIsBetter === null ? "–" : m.higherIsBetter === false ? "↓" : "↑";
                return (
                  <th
                    key={k}
                    onClick={() => goToMetric(k)}
                    title={`${m.label}${m.higherIsBetter === null ? " (unranked — no agreed better direction)" : ""} — click to compare peers`}
                    className="cursor-pointer px-1.5 py-1 text-center text-[11px] font-medium text-text-muted transition-colors hover:text-rbc-cyan"
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {m.shortLabel}
                      <span className="text-[9px] text-text-muted/70">{direction}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isHome = row.bank.isHomeInstitution;
              return (
                <tr
                  key={row.bank.bankId}
                  style={introAnim ? { animation: "fade-up 0.5s both", animationDelay: `${ri * 0.05}s` } : undefined}
                >
                  {/* Institution (sticky) */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 rounded-lg px-3 py-2 backdrop-blur",
                      isHome ? "bg-[#0e1c34] ring-1 ring-rbc-cyan/45" : "bg-surface/95"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* No position number: with the home institution pinned to the top, an
                          index would read as a standing the bank has not earned. Ranking now
                          lives only in the per-metric cells, where it is actually computed. */}
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ background: row.bank.colorHex, boxShadow: `0 0 0 3px ${row.bank.colorHex}22` }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 font-semibold text-text-primary">
                          {row.bank.ticker}
                          {isHome && <span className="text-rbc-cyan">★</span>}
                        </div>
                        <div className="truncate text-[10px] text-text-muted">{row.bank.bankName}</div>
                      </div>
                    </div>
                  </td>

                  {/* Metric heat cells */}
                  {row.cells.map((c) => {
                    const m = metaByKey.get(c.key)!;
                    if (c.value == null) {
                      return (
                        <td key={c.key} className="rounded-lg border border-border-soft bg-surface/40 text-center text-text-muted">
                          —
                        </td>
                      );
                    }
                    // Unranked-but-present: an unranked metric still shows its value, in
                    // neutral styling, so the reader sees the number without a false order.
                    if (c.rank == null) {
                      return (
                        <td
                          key={c.key}
                          title={`${m.label}: ${fmtVal(c.value, m)} — shown unranked (no agreed better direction)${c.offBasis ? " — reported, not adjusted, unlike the rest of this row" : ""}`}
                          className="rounded-lg border border-border-soft bg-surface/40 px-1.5 py-1.5 text-center"
                        >
                          <div className="font-display text-[13px] font-semibold tabular-nums text-text-primary">
                            {fmtVal(c.value, m)}
                            {c.derived && <span className="text-rbc-cyan">*</span>}
                            {c.offBasis && <span className="text-warn">&dagger;</span>}
                          </div>
                          <div className="text-[10px] font-medium text-text-muted">unranked</div>
                        </td>
                      );
                    }
                    const t = c.total > 1 ? (c.rank - 1) / (c.total - 1) : 0;
                    const [r, g, b] = heatRgb(t);
                    const isTop = c.rank === 1;
                    return (
                      <td
                        key={c.key}
                        title={`${m.label}: ${fmtVal(c.value, m)} — rank ${c.rank} of ${c.total}${c.derived ? " — computed, not disclosed by this bank" : ""}${c.offBasis ? " — reported, not adjusted, unlike the rest of this row" : ""}`}
                        className="rounded-lg border px-1.5 py-1.5 text-center transition-transform duration-150 hover:z-10 hover:scale-[1.06]"
                        style={{
                          background: `rgba(${r},${g},${b},0.17)`,
                          borderColor: `rgba(${r},${g},${b},${isTop ? 0.75 : 0.38})`,
                          boxShadow: isTop ? `0 0 14px -5px rgba(${r},${g},${b},0.75)` : undefined,
                        }}
                      >
                        <div className="font-display text-[13px] font-semibold tabular-nums text-text-primary">
                          {fmtVal(c.value, m)}
                          {c.derived && <span className="text-rbc-cyan">*</span>}
                          {c.offBasis && <span className="text-warn">&dagger;</span>}
                        </div>
                        <div className="text-[10px] font-medium tabular-nums" style={{ color: `rgb(${r},${g},${b})` }}>
                          #{c.rank}
                        </div>
                      </td>
                    );
                  })}

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-text-muted">
        Each cell shows the reported value and the bank&apos;s rank ({rows[0]?.cells[0]?.total ?? n} banks). ↑/↓ marks whether higher or lower is
        better; metrics with no agreed direction are shown unranked. RBC is pinned to the top row as the subject of the
        comparison — that position is not a standing; peers below it follow in average-rank order.{" "}
        <span className="text-rbc-cyan">*</span> marks a figure the bank does not publish, computed from figures it does —
        the Data Lineage tab carries the formula and the operands.{" "}
        <span className="text-warn">&dagger;</span> marks a metric labelled &ldquo;Adj.&rdquo; where this bank
        discloses no adjusted figure, so the value shown is its reported one, unlike the rest of the row.
        Click any metric to open its full peer comparison.
      </p>
    </GlassCard>
  );
}
