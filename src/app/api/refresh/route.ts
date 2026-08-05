import Anthropic from "@anthropic-ai/sdk";
import { friendlyApiError } from "@/lib/api-errors";
import { getAllBankData, getMetricsMeta } from "@/lib/data";
import { getNextQuarter, isLikelyReported, expectedReportDate, type ProposedQuarter, type MetricCheck } from "@/lib/quarters";
import { buildExtractionPrompt, parseExtraction, coerceMetrics, checkSanity } from "@/lib/refresh";
import { verifyAgainstSource } from "@/lib/source-verify";
import type { BankData, MetricMeta } from "@/types/metrics";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PAUSE_ITERATIONS = 6;
// Hard ceiling per bank so one slow extraction (e.g. exhaustively hunting for a
// quarter that hasn't been filed yet) can't stall the whole refresh.
const PER_BANK_TIMEOUT_MS = 120_000;

interface RefreshRequestBody {
  bankIds?: string[];
}

const encoder = new TextEncoder();
function line(obj: unknown) {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

async function extractQuarterText(client: Anthropic, prompt: string, requestSignal: AbortSignal): Promise<string> {
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let fullText = "";

  for (let i = 0; i < MAX_PAUSE_ITERATIONS; i++) {
    if (requestSignal.aborted) break;
    const stream = client.messages.stream(
      {
        // Sonnet 5 keeps extraction accurate while being materially faster than
        // Opus for this search-and-read task. Bounded tool uses stop it from
        // spiralling into endless searches when a quarter isn't out yet.
        model: "claude-sonnet-5",
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 6 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
        ],
        messages,
      },
      { signal: requestSignal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: final.content }];
      continue;
    }
    break;
  }
  return fullText;
}

async function refreshBank(
  client: Anthropic,
  bank: BankData,
  metricsMeta: MetricMeta[],
  outerSignal: { aborted: boolean },
  emit: (obj: unknown) => void,
): Promise<ProposedQuarter> {
  const latest = bank.quarters[bank.quarters.length - 1];
  const target = getNextQuarter(latest.period);

  const base: ProposedQuarter = {
    bankId: bank.bankId,
    bankName: bank.bankName,
    ticker: bank.ticker,
    targetPeriod: target?.period ?? "",
    periodEnd: target?.periodEnd ?? "",
    status: "error",
    metrics: {},
    notes: {},
    checks: {},
  };

  if (!target) {
    return { ...base, message: `Couldn't compute the next quarter after "${latest.period}".` };
  }

  // Fast path: don't spend a live web search hunting for a quarter that
  // calendarically can't be filed yet — report it as not-available instantly.
  if (!isLikelyReported(target)) {
    return {
      ...base,
      status: "not-available",
      message: `${target.period} (ended ${target.periodEnd}) isn't expected to be reported until around ${expectedReportDate(target)} — nothing new to pull yet.`,
    };
  }

  emit({ t: "status", bankId: bank.bankId, v: `Searching for ${bank.bankName} ${target.period} disclosures…` });

  const prompt = buildExtractionPrompt(bank, target, metricsMeta);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_BANK_TIMEOUT_MS);
  const onOuterAbort = setInterval(() => {
    if (outerSignal.aborted) ac.abort();
  }, 1000);

  let text: string;
  try {
    text = await extractQuarterText(client, prompt, ac.signal);
  } catch (err) {
    if (ac.signal.aborted && !outerSignal.aborted) {
      return { ...base, status: "error", message: `Timed out finding ${target.period} for ${bank.bankName} — try again, or check its investor-relations site manually.` };
    }
    console.error("[api/refresh]", bank.bankId, err);
    return { ...base, status: "error", message: friendlyApiError(err, `The refresh for ${bank.bankName}`) };
  } finally {
    clearTimeout(timer);
    clearInterval(onOuterAbort);
  }

  const parsed = parseExtraction(text);
  if (!parsed) {
    return { ...base, status: "error", message: "Couldn't parse a structured result from the model." };
  }
  if (parsed.status === "not-available") {
    const hint = !isLikelyReported(target) ? " (this quarter likely hasn't been filed yet)" : "";
    return { ...base, status: "not-available", message: (parsed.reason ?? "Not yet reported.") + hint };
  }

  const metrics = coerceMetrics(parsed.metrics, metricsMeta);
  const notes: ProposedQuarter["notes"] = {};
  for (const m of metricsMeta) {
    const n = parsed.notes?.[m.key];
    if (typeof n === "string") notes[m.key] = n;
  }

  emit({ t: "status", bankId: bank.bankId, v: `Verifying ${bank.bankName} figures against the cited source…` });
  const verified = await verifyAgainstSource(parsed.reportUrl, metrics, metricsMeta);

  const checks: ProposedQuarter["checks"] = {};
  const priorQ = bank.quarters[bank.quarters.length - 1];
  for (const m of metricsMeta) {
    const value = metrics[m.key];
    if (value === undefined && !(m.key in (parsed.metrics ?? {}))) continue;
    const sanity = checkSanity(m.key, value, priorQ.metrics[m.key]);
    const check: MetricCheck = { sanity: sanity.flag, sourceVerified: verified[m.key] ?? null, detail: sanity.detail };
    checks[m.key] = check;
  }

  return {
    ...base,
    status: "proposed",
    reportName: parsed.reportName,
    reportUrl: parsed.reportUrl,
    metrics,
    notes,
    checks,
  };
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(line({ t: "error", v: "Data refresh isn't configured — set ANTHROPIC_API_KEY in your environment." }) , {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as RefreshRequestBody;
  const allBanks = await getAllBankData();
  const metricsMeta = (await getMetricsMeta()).metrics;
  const banks = body.bankIds?.length ? allBanks.filter((b) => body.bankIds!.includes(b.bankId)) : allBanks;

  // Up to six sequential requests per bank across six banks — the default of 2 is thin.
  const client = new Anthropic({ maxRetries: 5 });
  const signal = { aborted: false };

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(line(obj));
      try {
        // Process banks with a small concurrency cap: fast enough that a full
        // 6-bank refresh isn't painfully sequential, but bounded so we don't
        // fan out too many concurrent web-research streams at once. Each bank
        // streams its own status + result as it finishes (keyed by bankId).
        const CONCURRENCY = 3;
        const queue = [...banks];
        async function worker() {
          while (!signal.aborted) {
            const bank = queue.shift();
            if (!bank) break;
            const result = await refreshBank(client, bank, metricsMeta, signal, emit);
            emit({ t: "bank", v: result });
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, banks.length) }, worker));
      } catch (err) {
        const msg = err instanceof Anthropic.APIError ? err.message : "The refresh hit an unexpected error.";
        emit({ t: "error", v: msg });
      } finally {
        emit({ t: "done" });
        controller.close();
      }
    },
    cancel() {
      signal.aborted = true;
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
