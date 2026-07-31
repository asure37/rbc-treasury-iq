import Anthropic from "@anthropic-ai/sdk";
import { registerDiscoveredSource, isSafePublicHttpUrl } from "@/lib/discovered-sources";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ITERATIONS = 12;

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
      notes: { type: "string", description: "Any caveat: basis, restatement, definition differences, or why the number may not be comparable." },
    },
    required: ["label", "entity", "period", "value", "quote", "sourceName", "sourceUrl", "sourceType"],
  },
};

const SYSTEM = `You are the Treasury IQ data-sourcing agent for RBC's CFO group.

Given a request for a specific figure — any metric, any company, any period, from investor
reports, supplementary financials, regulatory filings, earnings releases/calls or public
financial sources — you must:
1. Search for the figure.
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
- Keep any prose to two sentences; the structured finding carries the detail.`;

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

// Is the citation on the issuing organisation's own site, or a third-party aggregator?
const AGGREGATORS = ["prnewswire", "newswire", "businesswire", "globenewswire", "stocktitan", "tradingview", "yahoo", "marketwatch", "reuters", "bloomberg", "seekingalpha", "investing.com", "macrotrends", "wsj"];
function provenanceOf(entity: string, url: string): "first_party" | "third_party" {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "third_party"; }
  if (AGGREGATORS.some((a) => host.includes(a))) return "third_party";
  const tokens = entity.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length > 3 && !["financial", "corporation", "group", "bank", "inc", "the", "company", "holdings", "limited"].includes(t));
  return tokens.some((t) => host.includes(t)) ? "first_party" : "third_party";
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
  const needles = [...valueVariants(value), normalize(quote).slice(0, 80)].filter((s) => s.length > 1);

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
        const hit = needles.find((n) => text.includes(n));
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
    const hit = needles.find((n) => text.includes(n));
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
  const body = (await request.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) return new Response(JSON.stringify({ error: "A request is required." }), { status: 400 });

  const client = new Anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let confirmed = 0;
      try {
        let messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
        controller.enqueue(line("status", "Scanning primary sources…"));

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const s = client.messages.stream({
            // Haiku is the cheapest model that can drive this loop. It does not support
            // adaptive thinking or the newer programmatic server-tool versions, so the
            // basic web_search/web_fetch variants are required here.
            model: "claude-haiku-4-5",
            max_tokens: 3000,
            system: SYSTEM,
            tools: [
              { type: "web_search_20250305", name: "web_search", max_uses: 8 },
              { type: "web_fetch_20250910", name: "web_fetch", max_uses: 8 },
              REPORT_FINDING_TOOL,
            ],
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

          const final = await s.finalMessage();

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
            if (c.name !== "report_finding") {
              results.push({ type: "tool_result", tool_use_id: c.id, content: "Unknown tool.", is_error: true });
              continue;
            }
            const f = c.input as Record<string, string>;
            const verification = await verifyFinding(f.sourceUrl, f.value, f.quote ?? "");
            if (verification.status === "confirmed" && verification.isPdf) registerDiscoveredSource(f.sourceUrl);
            const provenance = provenanceOf(f.entity ?? "", f.sourceUrl ?? "");
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
        if (confirmed > 0) controller.enqueue(line("done", true));
        else controller.enqueue(line("error", err instanceof Error ? err.message : "Discovery failed."));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
