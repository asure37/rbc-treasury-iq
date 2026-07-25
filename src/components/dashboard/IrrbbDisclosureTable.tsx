import { ExternalLink } from "lucide-react";
import type { BankData } from "@/types/metrics";

// Qualitative comparison of how each bank discloses IRRBB — scenario coverage,
// EVE vs. NII, disclosure frequency — since disclosure practices themselves
// aren't a number that can be plotted, but are directly comparable text.
export function IrrbbDisclosureTable({ banks }: { banks: BankData[] }) {
  const withNotes = banks.filter((b) => b.irrbbDisclosureNote);

  if (withNotes.length === 0) {
    return <p className="text-sm text-text-muted">No IRRBB disclosure practice notes available yet for the selected banks.</p>;
  }

  return (
    <div className="space-y-3">
      {withNotes.map((b) => (
        <div key={b.bankId} className="rounded-xl border border-border-soft bg-surface/50 p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full" style={{ background: b.colorHex }} />
            <span className="font-display text-sm font-semibold text-text-primary">{b.bankName}</span>
            <span className="text-xs text-text-muted">({b.ticker})</span>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{b.irrbbDisclosureNote}</p>
          {b.irrbbDisclosureSourceUrl && (
            <a
              href={b.irrbbDisclosureSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-rbc-cyan hover:underline"
            >
              <ExternalLink className="size-3" />
              {b.irrbbDisclosureSourceName ?? "Source"}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
