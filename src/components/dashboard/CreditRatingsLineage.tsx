"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { useDashboardData } from "@/lib/data-context";
import type { RatingAgency } from "@/types/metrics";

const AGENCY_LABEL: Record<RatingAgency, string> = {
  moodys: "Moody's",
  sp: "S&P",
  dbrs: "DBRS",
  fitch: "Fitch",
};
const AGENCY_ORDER: RatingAgency[] = ["moodys", "sp", "dbrs", "fitch"];

export function CreditRatingsLineage() {
  const { banks } = useDashboardData();
  const rated = banks.filter((b) => b.creditRatings);
  if (!rated.length) return null;

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-up/10">
          <ShieldCheck className="size-4 text-up" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-primary">Credit Ratings &mdash; Lineage &amp; Sources</h3>
          <p className="text-[11px] text-text-muted">
            Long-term issuer / non-bail-inable senior ratings, taken verbatim from each bank&apos;s investor-relations
            credit-ratings page. Point-in-time (agency-action driven). Hover a chip for the exact line; click to open the source.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {rated.map((bank) => {
          const cr = bank.creditRatings!;
          return (
            <div key={bank.bankId} className="rounded-xl border border-border-soft bg-surface/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: bank.colorHex }} />
                  <span className="text-sm font-semibold text-text-primary">{bank.bankName}</span>
                  <span className="text-[11px] text-text-muted">
                    &middot; {cr.ratingType}
                    {cr.asOf && <> &middot; as of {cr.asOf}</>}
                  </span>
                </div>
                <a
                  href={cr.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-rbc-cyan hover:underline"
                >
                  <ExternalLink className="size-3" /> {cr.sourceName}
                </a>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AGENCY_ORDER.filter((a) => cr.agencies[a]).map((a) => {
                  const r = cr.agencies[a]!;
                  return (
                    <a
                      key={a}
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={r.verifiedText || `${AGENCY_LABEL[a]}: ${r.rating}`}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface-2/60 px-2.5 py-1 text-xs transition-colors hover:border-rbc-cyan/40 hover:bg-surface-2"
                    >
                      <span className="text-text-muted">{AGENCY_LABEL[a]}</span>
                      <span className="font-mono font-semibold text-text-primary group-hover:text-rbc-cyan">{r.rating}</span>
                      {r.outlook && <span className="text-[10px] text-text-muted">({r.outlook})</span>}
                    </a>
                  );
                })}
              </div>
              {cr.note && <p className="mt-2 text-[10px] leading-snug text-text-muted">{cr.note}</p>}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
