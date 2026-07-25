"use client";

import { ExternalLink } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { useDashboardData } from "@/lib/data-context";
import { cn } from "@/lib/cn";
import type { RatingAgency } from "@/types/metrics";

const AGENCY_LABEL: Record<RatingAgency, string> = {
  moodys: "Moody's",
  sp: "S&P",
  dbrs: "DBRS",
  fitch: "Fitch",
};
const AGENCY_ORDER: RatingAgency[] = ["moodys", "sp", "dbrs", "fitch"];

function outlookChip(outlook?: string | null): { label: string; cls: string } | null {
  if (!outlook) return null;
  const o = outlook.toLowerCase();
  if (o.startsWith("pos")) return { label: "Positive", cls: "border-up/30 bg-up/10 text-up" };
  if (o.startsWith("neg")) return { label: "Negative", cls: "border-down/40 bg-down/10 text-down" };
  if (o.startsWith("sta")) return { label: "Stable", cls: "border-border-soft bg-surface/60 text-text-muted" };
  return { label: outlook, cls: "border-border-soft bg-surface/60 text-text-muted" };
}

export function CreditRatingsSection() {
  const { banks } = useDashboardData();
  const rated = banks.filter((b) => b.creditRatings);
  if (!rated.length) return null;

  // Columns = agencies actually present across the rated banks, in canonical order.
  const present = new Set<RatingAgency>();
  for (const b of rated) for (const a of AGENCY_ORDER) if (b.creditRatings!.agencies[a]) present.add(a);
  const cols = AGENCY_ORDER.filter((a) => present.has(a));

  // Header "as of" = most recent verification date across banks.
  const asOf = rated.map((b) => b.creditRatings!.asOf).filter(Boolean).sort().at(-1);
  const asOfLabel = asOf
    ? new Date(`${asOf}T00:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    : null;

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-text-primary">
          Credit Ratings &mdash; Long-Term Issuer / Senior Debt
        </h3>
        {asOfLabel && (
          <span className="rounded-full border border-border-soft bg-surface/50 px-2.5 py-1 text-[11px] text-text-muted">
            Point-in-time &middot; as of {asOfLabel}
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-text-muted">
        Long-term ratings from each agency&apos;s own scale. Ratings change only on agency action (not every quarter);
        each is linked to the bank&apos;s investor-relations disclosure. Outlook shown where published.
      </p>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="rounded-lg bg-surface/60 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Institution
              </th>
              {cols.map((a) => (
                <th key={a} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  {AGENCY_LABEL[a]}
                </th>
              ))}
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">Source</th>
            </tr>
          </thead>
          <tbody>
            {rated.map((bank) => {
              const cr = bank.creditRatings!;
              const isHome = bank.isHomeInstitution;
              return (
                <tr key={bank.bankId}>
                  <td
                    className={cn(
                      "rounded-lg px-3 py-2 align-middle",
                      isHome ? "bg-[#0e1c34] ring-1 ring-rbc-cyan/45" : "bg-surface/60"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: bank.colorHex }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 font-semibold text-text-primary">
                          {bank.ticker}
                          {isHome && <span className="text-rbc-cyan">&#9733;</span>}
                        </div>
                        <div className="truncate text-[10px] text-text-muted" title={cr.ratingType}>
                          {cr.ratingType}
                        </div>
                      </div>
                    </div>
                  </td>

                  {cols.map((a) => {
                    const r = cr.agencies[a];
                    if (!r) {
                      return (
                        <td key={a} className="rounded-lg border border-border-soft bg-surface/30 text-center text-text-muted">
                          &mdash;
                        </td>
                      );
                    }
                    const chip = outlookChip(r.outlook);
                    return (
                      <td key={a} className="rounded-lg border border-border-soft bg-surface/40 px-2 py-1.5 text-center">
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={r.verifiedText || `${AGENCY_LABEL[a]}: ${r.rating}`}
                          className="group inline-flex flex-col items-center gap-0.5"
                        >
                          <span className="font-display text-sm font-bold tabular-nums text-text-primary group-hover:text-rbc-cyan">
                            {r.rating}
                          </span>
                          {chip && (
                            <span className={cn("rounded-full border px-1.5 py-px text-[9px] font-medium", chip.cls)}>{chip.label}</span>
                          )}
                        </a>
                      </td>
                    );
                  })}

                  <td className="rounded-lg px-2 py-1.5 text-right align-middle">
                    <a
                      href={cr.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={cr.sourceName}
                      className="inline-flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-rbc-cyan"
                    >
                      IR page <ExternalLink className="size-3" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
