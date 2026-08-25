// Core data model for the treasury peer-benchmarking dashboard.
// All monetary figures are in the bank's reporting currency (CAD millions/billions) unless noted.

export type MetricKey =
  | "cet1Ratio"
  | "tier1CapitalRatio"
  | "totalCapitalRatio"
  | "leverageRatio"
  | "tlacRatio"
  | "tlacLeverageRatio"
  | "lcr"
  | "lcrBufferBillions"
  | "nsfr"
  | "roe"
  | "roa"
  | "rotce"
  | "equityMultiplier"
  | "adjustedDilutedEps"
  | "nim"
  | "dividendPayoutRatio"
  | "efficiencyRatio"
  | "adjustedOperatingLeverage"
  | "loansToAssetsPct"
  | "totalAssetsBillions"
  | "netIncomeMillions"
  | "loanToDepositRatio"
  | "wholesaleFundingPct"
  | "retailDepositsPct"
  | "wholesaleDepositsPct"
  | "stableDepositsPct"
  | "lessStableDepositsPct"
  | "operationalDepositsPct"
  | "nonOperationalDepositsPct"
  | "irrbbEveSensitivityPct"
  | "irrbbNiiSensitivityPct";

export interface MetricMeta {
  key: MetricKey;
  label: string;
  shortLabel: string;
  unit: "%" | "$B" | "$M" | "x" | "$"; // "x" = a plain multiple, e.g. an equity multiplier of 20.0x
  description: string;
  higherIsBetter: boolean | null; // null = context-dependent (e.g., balance sheet mix)
  regulatoryMinimum?: number; // Basel III / OSFI floor, in same unit as value
  supervisoryTarget?: number; // OSFI D-SIB supervisory target/buffer-inclusive expectation
  decimals: number;
}

// Points a single metric value at the exact spot it came from in a source
// document: which PDF (defaults to the quarter's reportUrl), which page, and
// a short distinctive phrase/figure to search for and highlight on that page.
export interface SourceRef {
  url?: string; // overrides reportUrl/supplementaryReportUrl when the figure comes from a different document
  page?: number; // 1-indexed PDF page number
  searchText?: string; // distinctive phrase/figure to locate and highlight on that page
  // Label text that precedes the figure on the page (e.g. "common equity tier 1 (cet1) ratio").
  // Required whenever searchText alone is ambiguous — several metrics can share the same
  // value on one page (BMO Q2 2026 reports ROE and CET1 both at 13.0%), and without an
  // anchor the viewer would highlight whichever occurrence came first.
  anchorText?: string;
}

export interface QuarterMetrics {
  period: string; // e.g. "Q2 2026"
  periodEnd: string; // ISO date, fiscal quarter end e.g. "2026-04-30"
  reportName: string; // e.g. "Q2 2026 Report to Shareholders"
  reportUrl: string; // link to the source disclosure
  supplementaryReportName?: string; // e.g. "Supplementary Regulatory Capital Disclosure"
  supplementaryReportUrl?: string;
  retrievedAt: string; // ISO datetime this data point was ingested/verified
  metrics: Partial<Record<MetricKey, number | null>>;
  notes?: Partial<Record<MetricKey, string>>; // per-metric caveats (e.g., "not disclosed this quarter")
  // Metrics this issuer does NOT publish, whose value we computed from figures it does
  // publish. Structural, not inferred from note text: the UI marks these with an
  // asterisk so a reader never mistakes a derived ratio for a disclosed one.
  derived?: Partial<Record<MetricKey, true>>;
  // Metrics labelled "adjusted" throughout the dataset (Adj. ROE, Adj. ROA, Adj.
  // Payout Ratio, ...) for which THIS issuer discloses no adjusted figure, so the
  // value here is its reported/as-disclosed one instead -- e.g. CIBC's ROA, or
  // RBC's and National's dividend payout ratio. Distinct from `derived`: these are
  // disclosed, not computed; the mismatch is basis, not provenance. The UI marks
  // these with a dagger so a reader never assumes every "Adj." column is uniform.
  offBasis?: Partial<Record<MetricKey, true>>;
  sourceRefs?: Partial<Record<MetricKey, SourceRef>>; // precise page/location within the source, where known
}

// Credit ratings are point-in-time (they change only on rating-agency action, not
// every quarter), so they live at the bank level with an "as of" date rather than in
// each QuarterMetrics. Each agency rating carries its own verifiable source citation.
export type RatingAgency = "moodys" | "sp" | "dbrs" | "fitch";

export interface AgencyRating {
  rating: string; // agency-native long-term scale, e.g. "Aa2" (Moody's), "AA-" (S&P), "AA" (DBRS)
  outlook?: string | null; // "Stable" | "Positive" | "Negative" | null (unknown/not shown)
  sourceUrl: string; // page/document where this rating was verified
  sourceLabel?: string; // human label for the source (e.g. agency name / IR page)
  verifiedText?: string; // verbatim line as printed, for the lineage trail
}

export interface CreditRatings {
  asOf: string; // ISO date the ratings were verified / in effect
  ratingType: string; // what the ratings describe, e.g. "Long-term senior debt (legacy)"
  sourceName: string; // primary source, e.g. "RBC Investor Relations — Credit Ratings"
  sourceUrl: string; // the investor-relations credit-ratings page (HTML, opens externally)
  note?: string; // caveats (entity covered, negative-outlook context, etc.)
  agencies: Partial<Record<RatingAgency, AgencyRating>>;
}

// Inputs for the live Price-to-Book chart: a disclosed book value per common share
// (denominator) plus a Yahoo Finance symbol and a disclosed fallback close price.
export interface MarketData {
  yahooSymbol: string; // e.g. "RY.TO"
  bookValuePerShare: number; // disclosed, in CAD
  bvpsAsOf: string;
  bvpsNote: string;
  bvpsSourceUrl: string;
  refClosePrice: number; // disclosed quarter-end close, used when the live feed is unreachable
  refCloseDate: string; // YYYY-MM-DD
}

export interface BankData {
  bankId: string; // e.g. "rbc"
  bankName: string; // e.g. "Royal Bank of Canada"
  ticker: string; // e.g. "RY"
  isHomeInstitution?: boolean; // true for RBC
  colorHex: string; // brand color used in charts
  quarters: QuarterMetrics[]; // ordered oldest -> newest
  // Qualitative IRRBB disclosure practices (scenarios covered, metrics disclosed,
  // frequency) — sourced from the bank's most recent Pillar 3 / AIF filing.
  // Not per-quarter since it describes a disclosure framework, not a point-in-time value.
  irrbbDisclosureNote?: string;
  irrbbDisclosureSourceName?: string;
  irrbbDisclosureSourceUrl?: string;
  // Long-term issuer/senior-debt ratings from Moody's, S&P, DBRS (and Fitch where
  // disclosed). Point-in-time; see CreditRatings.asOf.
  creditRatings?: CreditRatings;
  // Live-valuation inputs (book value per share + ticker) for the Price-to-Book chart.
  marketData?: MarketData;
}

export interface DatasetManifest {
  generatedAt: string;
  banks: string[]; // bankIds present
  quarterRange: { start: string; end: string };
  sourceMethodology: string;
}
