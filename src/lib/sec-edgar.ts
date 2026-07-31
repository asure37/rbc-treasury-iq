// Structured filing data from SEC EDGAR — the same primary dataset the Python
// `edgartools` / `finagg` packages wrap, used directly over EDGAR's public JSON APIs so
// it deploys with the Node app (no Python sidecar).
//
// Why this matters for the data trail: every XBRL fact carries the accession number of
// the filing it was reported in, so a figure can be cited to an exact filing, period and
// tag rather than to prose we scraped off a page.

const UA = "TreasuryIQ RBC-CaseComp (contact: investor-analytics@example.com)";
const DAY = 86_400_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---- company resolution ----------------------------------------------------
interface TickerRow { cik_str: number; ticker: string; title: string }
let tickerCache: { at: number; rows: TickerRow[] } | null = null;

async function tickerRows(): Promise<TickerRow[]> {
  if (tickerCache && Date.now() - tickerCache.at < 7 * DAY) return tickerCache.rows;
  const data = await getJson<Record<string, TickerRow>>("https://www.sec.gov/files/company_tickers.json");
  const rows = data ? Object.values(data) : [];
  if (rows.length) tickerCache = { at: Date.now(), rows };
  return rows;
}

export interface Company { cik: string; ticker: string; title: string }

export async function resolveCompany(query: string): Promise<Company[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await tickerRows();
  const pad = (n: number) => String(n).padStart(10, "0");
  const exactTicker = rows.filter((r) => r.ticker.toLowerCase() === q);
  const byName = rows.filter((r) => r.title.toLowerCase().includes(q));
  const startsName = rows.filter((r) => r.title.toLowerCase().startsWith(q));
  const ranked = [...exactTicker, ...startsName, ...byName];
  const seen = new Set<number>();
  return ranked
    .filter((r) => (seen.has(r.cik_str) ? false : (seen.add(r.cik_str), true)))
    .slice(0, 8)
    .map((r) => ({ cik: pad(r.cik_str), ticker: r.ticker, title: r.title }));
}

// ---- company facts ---------------------------------------------------------
interface FactUnitEntry { end?: string; start?: string; val: number; fy?: number; fp?: string; form?: string; accn?: string; frame?: string }
interface FactsResponse {
  entityName?: string;
  facts?: Record<string, Record<string, { label?: string; description?: string; units?: Record<string, FactUnitEntry[]> }>>;
}

const factsCache = new Map<string, { at: number; data: FactsResponse }>();

async function companyFacts(cik: string): Promise<FactsResponse | null> {
  const hit = factsCache.get(cik);
  if (hit && Date.now() - hit.at < DAY) return hit.data;
  const data = await getJson<FactsResponse>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (data) {
    if (factsCache.size > 40) factsCache.delete(factsCache.keys().next().value as string);
    factsCache.set(cik, { at: Date.now(), data });
  }
  return data;
}

export interface TagMatch { taxonomy: string; tag: string; label?: string; units: string[]; observations: number }

/** Find reported XBRL tags whose name or label matches a keyword. */
export async function findTags(cik: string, keyword: string, limit = 25): Promise<TagMatch[]> {
  const facts = await companyFacts(cik);
  if (!facts?.facts) return [];
  const k = keyword.toLowerCase().replace(/\s+/g, "");
  const out: TagMatch[] = [];
  for (const [taxonomy, tags] of Object.entries(facts.facts)) {
    for (const [tag, body] of Object.entries(tags)) {
      const hay = (tag + " " + (body.label ?? "")).toLowerCase().replace(/\s+/g, "");
      if (!k || hay.includes(k)) {
        const units = Object.keys(body.units ?? {});
        out.push({
          taxonomy,
          tag,
          label: body.label,
          units,
          observations: units.reduce((n, u) => n + (body.units?.[u]?.length ?? 0), 0),
        });
      }
    }
  }
  return out.sort((a, b) => b.observations - a.observations).slice(0, limit);
}

export interface FactValue {
  value: number;
  unit: string;
  periodStart?: string;
  periodEnd?: string;
  fiscalYear?: number;
  fiscalPeriod?: string;
  form?: string;
  accession?: string;
  filingUrl?: string;
}

/** Most recent reported values for one tag, newest first, each linked to its filing. */
export async function getFactValues(cik: string, taxonomy: string, tag: string, limit = 8): Promise<{ label?: string; values: FactValue[] }> {
  const facts = await companyFacts(cik);
  const body = facts?.facts?.[taxonomy]?.[tag];
  if (!body?.units) return { values: [] };
  const rows: FactValue[] = [];
  for (const [unit, entries] of Object.entries(body.units)) {
    for (const e of entries) {
      rows.push({
        value: e.val,
        unit,
        periodStart: e.start,
        periodEnd: e.end,
        fiscalYear: e.fy,
        fiscalPeriod: e.fp,
        form: e.form,
        accession: e.accn,
        filingUrl: e.accn ? filingIndexUrl(cik, e.accn) : undefined,
      });
    }
  }
  rows.sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));
  return { label: body.label, values: rows.slice(0, limit) };
}

export function filingIndexUrl(cik: string, accession: string): string {
  const plain = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${plain}/${accession}-index.htm`;
}
