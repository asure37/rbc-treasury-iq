import Anthropic from "@anthropic-ai/sdk";
import { registerDiscoveredSource, isSafePublicHttpUrl } from "@/lib/discovered-sources";
import { resolveCompany, findTags, getFactValues } from "@/lib/sec-edgar";
import { getAllBankData } from "@/lib/data";
import { indexOfValue } from "@/lib/source-match";
import { friendlyApiError, isRetryableApiError, API_RETRY_BACKOFF_MS } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ITERATIONS = 10;

// Structured filing data (SEC EDGAR XBRL). Gives the agent exact reported values with
// the filing accession attached, instead of relying on reading prose off a web page.
const SEC_XBRL_TOOL: Anthropic.Tool = {
  name: "sec_xbrl",
  description:
    "Look up exact figures a company reported to the SEC in XBRL (the structured data behind its filings). Use this FIRST for any SEC registrant — it returns authoritative values with the filing they came from. Workflow: resolve_company -> find_tags (search by keyword, e.g. 'deposits', 'equity', 'revenue') -> get_values. Canadian banks file IFRS tags (taxonomy 'ifrs-full'); US filers use 'us-gaap'.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["resolve_company", "find_tags", "get_values"] },
      query: { type: "string", description: "resolve_company: company name or ticker. find_tags: keyword to search tag names/labels." },
      cik: { type: "string", description: "10-digit CIK from resolve_company (required for find_tags and get_values)." },
      taxonomy: { type: "string", description: "get_values: e.g. 'ifrs-full' or 'us-gaap'." },
      tag: { type: "string", description: "get_values: the XBRL tag name." },
    },
    required: ["action"],
  },
};

// The model must return its answer through this tool, so every finding arrives as
// structured, checkable fields rather than prose we would have to parse.
const REPORT_FINDING_TOOL: Anthropic.Tool = {
  name: "report_finding",
  description:
    "Report one located figure together with the primary source it came from. Call this only once you have opened the source document and can see the figure in it. Prefer the issuing organisation's own filing (annual/quarterly report, supplementary financial information, regulatory disclosure, earnings release or transcript) over any third-party website.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string", description: "What the figure measures, e.g. 'LICAT total ratio' or 'Assets under administration'." },
      entity: { type: "string", description: "Company/entity the figure belongs to." },
      period: { type: "string", description: "Reporting period, e.g. 'Q2 2026' or 'FY2025'." },
      value: { type: "string", description: "The figure EXACTLY as printed in the source, e.g. '137%', '$1,085,470 million', '2.05'." },
      labelText: { type: "string", description: "The row/label text exactly as printed immediately before the figure in the source, used to pinpoint it." },
      quote: { type: "string", description: "A short verbatim sentence or table row from the source containing the figure." },
      sourceName: { type: "string", description: "Human name of the document, e.g. 'Manulife Q2 2026 Report to Shareholders'." },
      sourceUrl: { type: "string", description: "Direct https URL to the source document (PDF preferred)." },
      sourceType: { type: "string", enum: ["investor_report", "supplementary_financials", "regulatory_filing", "earnings_release", "earnings_call", "press_release", "website", "other"] },
      asOf: { type: "string", description: "Date the figure is as-of, if stated." },
      xbrlCik: { type: "string", description: "If the figure came from sec_xbrl, the 10-digit CIK." },
      xbrlTaxonomy: { type: "string", description: "If from sec_xbrl, the taxonomy (e.g. 'ifrs-full')." },
      xbrlTag: { type: "string", description: "If from sec_xbrl, the XBRL tag name." },
      xbrlPeriodEnd: { type: "string", description: "If from sec_xbrl, the periodEnd of the value (YYYY-MM-DD)." },
      notes: { type: "string", description: "Any caveat: basis, restatement, definition differences, or why the number may not be comparable." },
    },
    required: ["label", "entity", "period", "value", "quote", "sourceName", "sourceUrl", "sourceType"],
  },
};

const SYSTEM = `You are the Treasury IQ data-sourcing agent for RBC's CFO group.

Given a request for a specific figure — any metric, any company, any period, from investor
reports, supplementary financials, regulatory filings, earnings releases/calls or public
financial sources — you must:
0. If the company files with the SEC, try the sec_xbrl tool FIRST. It returns the exact
   values the company reported in XBRL, each tagged with the filing it came from, which is
   more reliable than reading a number off a web page. Resolve the company, search tags by
   keyword, then read values. Canadian banks use the 'ifrs-full' taxonomy.
   ALWAYS call report_finding for a figure obtained this way — set sourceType to
   'regulatory_filing', use the filingUrl as sourceUrl, pass xbrlCik / xbrlTaxonomy /
   xbrlTag / xbrlPeriodEnd so it can be checked against the filed data, and put the tag,
   period and accession number in notes. Report a single reported tag rather than summing
   several tags together; if the analyst needs a total that is not itself reported, give
   the components as separate findings and explain the arithmetic in text.
   XBRL values are reported in absolute units (e.g. 1085470000000 = $1,085,470 million) —
   state the value as reported and explain the scale in notes.
1. Otherwise, search for the figure.
2. OPEN the actual source document and read the figure in it. Never report a number you
   have not seen in the source you cite.
3. Strongly prefer the issuing organisation's own disclosure over aggregator/third-party
   sites. A direct PDF is best because it can be highlighted for the analyst.
4. Call report_finding with the figure EXACTLY as printed, the label text printed next to
   it, and a short verbatim quote containing it.

Rules:
- Match the period that was asked for. If that period is not published yet, do NOT silently
  substitute an earlier one: say so in text, and only report an earlier period if you state
  clearly in 'period' and 'notes' which period you actually found.
- The issuing organisation's own website is strongly preferred. Use a newswire/aggregator
  (prnewswire, newswire.ca, businesswire, stocktitan, tradingview, sec.gov mirrors) ONLY
  after you have tried the company's own investor-relations documents and failed.
- If you cannot find the figure in a primary source, say so plainly in text and do not call
  report_finding. Never estimate, interpolate or infer a value.
- If sources disagree or the figure is defined differently across companies, report the one
  you can see and explain the discrepancy in notes.
- Keep any prose to two sentences; the structured finding carries the detail.

Follow-up questions: the analyst may ask about a figure you already reported. If their
question can be answered from a finding already in this conversation (what it means, how
it is defined, why it moved, how it compares to something else already established),
answer in text and do NOT call report_finding again. Only run a new scan and call
report_finding when they are asking for a different figure that has not been sourced yet.`;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function valueVariants(v: string): string[] {
  const n = normalize(v);
  const out = new Set([n]);
  out.add(n.replace(/\$\s*/g, "$ "));
  out.add(n.replace(/\$\s*/g, "").trim());
  out.add(n.replace(/[$,]/g, "").trim());
  out.add(n.replace(/\s*%/, "%"));
  return [...out].filter(Boolean);
}

/**
 * What to look for in the document. A finding's value usually carries a currency symbol
 * and a unit word — "$1,484 million" — while the statement itself prints "$ 1,484" in a
 * column, so the bare number has to be one of the candidates. Matching is
 * boundary-aware, so "1,484" cannot be satisfied by "21,484".
 */
function verificationNeedles(value: string, quote: string): string[] {
  const out = new Set(valueVariants(value));
  const core = normalize(value)
    .replace(/[$€£]/g, "")
    .replace(/\b(million|billion|thousand|mm|bn)\b/g, "")
    .trim();
  if (core) out.add(core);
  // Agents often elide the middle of a quote with "..."; the longest intact run is more
  // likely to appear verbatim than the whole thing.
  const runs = normalize(quote).split(/\.{3,}|…/).map((r) => r.trim());
  const longest = runs.sort((a, b) => b.length - a.length)[0] ?? "";
  if (longest.length > 12) out.add(longest.slice(0, 80));
  return [...out].filter((n) => n.length > 1);
}

// Is the citation on the issuing organisation's own site, or a third-party aggregator?
const AGGREGATORS = ["prnewswire", "newswire", "businesswire", "globenewswire", "stocktitan", "tradingview", "yahoo", "marketwatch", "reuters", "bloomberg", "seekingalpha", "investing.com", "macrotrends", "wsj"];
const nameTokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length > 3 && !["financial", "corporation", "group", "bank", "inc", "the", "company", "holdings", "limited"].includes(t));

// A bank's own domain rarely contains a word from its name: "Royal Bank of Canada"
// yields royal/canada, neither of which is in rbc.com, so RBC's own Report to
// Shareholders was being labelled a third-party source. The dataset already records
// each issuer's document domain, so use it rather than guessing from the name.
let issuerDomains: { host: string; tokens: string[] }[] | null = null;
async function knownIssuers() {
  if (issuerDomains) return issuerDomains;
  try {
    const banks = await getAllBankData();
    issuerDomains = banks
      .map((b) => {
        let host = "";
        try { host = new URL(b.quarters[0]?.reportUrl ?? "").hostname.toLowerCase().replace(/^www\./, ""); } catch { /* skip */ }
        return { host, tokens: [b.ticker.toLowerCase(), ...nameTokens(b.bankName)] };
      })
      .filter((x) => x.host);
  } catch {
    issuerDomains = [];
  }
  return issuerDomains;
}

async function provenanceOf(entity: string, url: string): Promise<"first_party" | "third_party"> {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "third_party"; }
  if (host.endsWith("sec.gov")) return "first_party"; // the regulator's copy of the company's own filing
  if (AGGREGATORS.some((a) => host.includes(a))) return "third_party";

  const known = (await knownIssuers()).find((k) => host === k.host || host.endsWith("." + k.host));
  if (known) {
    const e = entity.toLowerCase();
    if (known.tokens.some((t) => e.includes(t))) return "first_party";
  }
  return nameTokens(entity).some((t) => host.includes(t)) ? "first_party" : "third_party";
}

interface Verification {
  status: "confirmed" | "not_found" | "unreachable" | "unsupported";
  page?: number;
  detail: string;
  isPdf: boolean;
  // The exact string that was found in the document. The viewer highlights this rather
  // than the model's rendering of the value, so the box lands on the real characters.
  matched?: string;
}

// Independently re-open the cited document server-side and confirm the figure is
// actually in it. This is what turns "the model said so" into a checkable trail.
async function verifyFinding(url: string, value: string, quote: string): Promise<Verification> {
  if (!isSafePublicHttpUrl(url)) return { status: "unsupported", detail: "Source URL is not a public https address.", isPdf: false };

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TreasuryIQ/1.0)" }, signal: AbortSignal.timeout(45_000) });
  } catch {
    return { status: "unreachable", detail: "Could not fetch the source document.", isPdf: false };
  }
  if (!res.ok) return { status: "unreachable", detail: `Source returned HTTP ${res.status}.`, isPdf: false };

  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  const isPdf = ctype.includes("pdf") || url.toLowerCase().split("?")[0].endsWith(".pdf");
  const needles = verificationNeedles(value, quote);

  if (isPdf) {
    try {
      const buf = new Uint8Array(await res.arrayBuffer());
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;
      const cap = Math.min(doc.numPages, 220);
      for (let p = 1; p <= cap; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const text = normalize((tc.items as { str: string }[]).map((i) => i.str).join(" "));
        const hit = needles.find((n) => indexOfValue(text, n) !== -1);
        if (hit) {
          return { status: "confirmed", page: p, detail: `Figure located on page ${p} of the source PDF.`, isPdf: true, matched: hit };
        }
      }
      return { status: "not_found", detail: "Opened the PDF but could not locate this figure in its text.", isPdf: true };
    } catch (err) {
      return { status: "unreachable", detail: `Source PDF could not be read (${err instanceof Error ? err.message.slice(0, 80) : "parse error"}).`, isPdf: true };
    }
  }

  try {
    const html = await res.text();
    const text = normalize(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    const hit = needles.find((n) => indexOfValue(text, n) !== -1);
    if (hit) return { status: "confirmed", detail: "Figure found in the page content.", isPdf: false, matched: hit };
    return { status: "not_found", detail: "Opened the page but could not locate this figure in its text.", isPdf: false };
  } catch {
    return { status: "unreachable", detail: "Source page could not be read.", isPdf: false };
  }
}

const line = (event: string, data: unknown) => new TextEncoder().encode(JSON.stringify({ event, data }) + "\n");



export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "The assistant is not configured (missing ANTHROPIC_API_KEY)." }), { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as
    | { query?: string; history?: { role?: string; content?: string }[] }
    | null;
  const query = body?.query?.trim();
  if (!query) return new Response(JSON.stringify({ error: "A request is required." }), { status: 400 });

  // Prior turns are carried as plain text only. Replaying raw assistant tool blocks would
  // require pairing every server-tool result back up; a text transcript keeps follow-ups
  // stateless and avoids that entirely.
  const history: Anthropic.MessageParam[] = (body?.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.slice(0, 4000) }));

  // Covers connection-level failures. It does NOT cover a mid-stream overload: the SDK
  // decides retries from the HTTP response, and an SSE error frame arrives after the
  // 200 has been committed. The explicit retry around each iteration handles that.
  const client = new Anthropic({ maxRetries: 4 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let confirmed = 0;
      // The dynamic-filtering web tools run code execution server-side, so a turn that
      // calls one is bound to a container. Continuing that turn without echoing the
      // container back fails with "container_id is required when there are pending
      // tool uses generated by code execution with tools".
      let containerId: string | undefined;
      try {
        let messages: Anthropic.MessageParam[] = [...history, { role: "user", content: query }];
        controller.enqueue(line("status", "Scanning primary sources…"));

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          // One iteration, retried on transient service failures. A 529 part-way through
          // a multi-step scan used to abort the whole run and print the API's raw JSON
          // body into the transcript; now it waits and tries the step again.
          let final: Anthropic.Message | undefined;
          for (let attempt = 0; ; attempt++) {
            try {
              const s = client.messages.stream({
                // Sonnet 5 has a 1M-token context — five times Haiku's — so opening several
                // large filings in one scan no longer overruns the window.
                model: "claude-sonnet-5",
                max_tokens: 3000,
                thinking: { type: "adaptive" },
                system: SYSTEM,
                tools: [
                  { type: "web_search_20260209", name: "web_search", max_uses: 6 },
                  // Still capped per document so a 300-page annual report doesn't dominate
                  // the window (or the bill) on its own.
                  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 40000 },
                  SEC_XBRL_TOOL,
                  REPORT_FINDING_TOOL,
                ],
                ...(containerId ? { container: containerId } : {}),
                messages,
              });

              for await (const ev of s) {
                if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") {
                  controller.enqueue(line("status", ev.content_block.name === "web_fetch" ? "Opening the source document…" : "Scanning sources…"));
                }
                if (ev.type === "content_block_start" && ev.content_block.type === "tool_use" && ev.content_block.name === "report_finding") {
                  controller.enqueue(line("status", "Verifying the figure against the source…"));
                }
                if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
                  controller.enqueue(line("text", ev.delta.text));
                }
              }

              final = await s.finalMessage();
              break;
            } catch (err) {
              if (!isRetryableApiError(err) || attempt >= API_RETRY_BACKOFF_MS.length) throw err;
              controller.enqueue(line("status", "The model service is busy — retrying…"));
              await new Promise((r) => setTimeout(r, API_RETRY_BACKOFF_MS[attempt]));
            }
          }
          if (!final) break;
          if (final.container?.id) containerId = final.container.id;

          if (final.stop_reason === "pause_turn") {
            messages = [...messages, { role: "assistant", content: final.content }];
            continue;
          }
          if (final.stop_reason !== "tool_use") break;

          const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (!calls.length) break;
          messages = [...messages, { role: "assistant", content: final.content }];

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const c of calls) {
            if (c.name === "sec_xbrl") {
              const a = c.input as { action: string; query?: string; cik?: string; taxonomy?: string; tag?: string };
              try {
                let payload: unknown;
                if (a.action === "resolve_company") {
                  controller.enqueue(line("status", "Resolving the filer on SEC EDGAR…"));
                  payload = await resolveCompany(a.query ?? "");
                } else if (a.action === "find_tags") {
                  controller.enqueue(line("status", "Searching reported XBRL tags…"));
                  payload = await findTags(a.cik ?? "", a.query ?? "");
                } else if (a.action === "get_values") {
                  controller.enqueue(line("status", "Reading reported values from the filing…"));
                  payload = await getFactValues(a.cik ?? "", a.taxonomy ?? "", a.tag ?? "");
                } else {
                  payload = { error: "Unknown action." };
                }
                results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(payload).slice(0, 8000) });
              } catch {
                results.push({ type: "tool_result", tool_use_id: c.id, content: "EDGAR lookup failed.", is_error: true });
              }
              continue;
            }
            if (c.name !== "report_finding") {
              results.push({ type: "tool_result", tool_use_id: c.id, content: "Unknown tool.", is_error: true });
              continue;
            }
            const f = c.input as Record<string, string>;
            // A figure taken from XBRL is checked against the filed data itself — stronger
            // than text-matching, since an EDGAR index page never contains the number.
            let verification: Verification;
            if (f.xbrlTag && f.xbrlCik && f.xbrlTaxonomy) {
              const { values } = await getFactValues(f.xbrlCik, f.xbrlTaxonomy, f.xbrlTag, 40);
              const target = Number(String(f.value).replace(/[^0-9.-]/g, ""));
              const match = values.find((v) => {
                if (f.xbrlPeriodEnd && v.periodEnd !== f.xbrlPeriodEnd) return false;
                if (!Number.isFinite(target) || target === 0) return false;
                // accept the figure stated in units or in millions
                return Math.abs(v.value - target) < 1 || Math.abs(v.value / 1e6 - target) < 1;
              });
              verification = match
                ? {
                    status: "confirmed",
                    detail: `Matched the value ${match.value.toLocaleString()} reported under XBRL tag ${f.xbrlTag} for period ending ${match.periodEnd} (${match.form ?? "filing"} ${match.accession ?? ""}).`,
                    isPdf: false,
                  }
                : {
                    status: "not_found",
                    detail: `No value matching ${f.value} was reported under ${f.xbrlTag}${f.xbrlPeriodEnd ? ` for period ending ${f.xbrlPeriodEnd}` : ""}.`,
                    isPdf: false,
                  };
            } else {
              verification = await verifyFinding(f.sourceUrl, f.value, f.quote ?? "");
            }
            if (verification.status === "confirmed" && verification.isPdf) registerDiscoveredSource(f.sourceUrl);
            const provenance = await provenanceOf(f.entity ?? "", f.sourceUrl ?? "");
            if (verification.status === "confirmed") confirmed++;

            controller.enqueue(line("finding", { ...f, verification, provenance }));

            results.push({
              type: "tool_result",
              tool_use_id: c.id,
              content:
                verification.status === "confirmed"
                  ? `Verified: the figure appears in the cited source${verification.page ? ` (page ${verification.page})` : ""}. Summarise the finding for the analyst in one or two sentences.`
                  : `Verification FAILED (${verification.status}): ${verification.detail} Either cite a source where the figure is actually visible, or tell the analyst plainly that it could not be verified.`,
              is_error: verification.status !== "confirmed",
            });
          }
          // A verified finding is already streamed to the analyst; continuing the
          // conversation only risks a follow-up API error for no added value.
          if (confirmed > 0) break;
          messages = [...messages, { role: "user", content: results }];
        }
        controller.enqueue(line("done", true));
      } catch (err) {
        if (confirmed > 0) {
          controller.enqueue(line("done", true));
        } else {
          controller.enqueue(line("error", friendlyApiError(err, "The scan")));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
