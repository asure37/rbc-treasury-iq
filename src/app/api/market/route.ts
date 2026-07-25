import { NextResponse } from "next/server";
import { getAllBankData } from "@/lib/data";

// Always run fresh (this pulls a live quote) — never statically cached at build.
export const dynamic = "force-dynamic";

interface Quote {
  bankId: string;
  ticker: string;
  yahooSymbol: string;
  bookValuePerShare: number;
  price: number;
  priceToBook: number;
  live: boolean; // true = live quote; false = disclosed quarter-end fallback
  asOfClose?: string; // disclosed close date, only when not live
}

// Small in-memory cache so multiple viewers / quick reloads don't hammer the quote feed.
let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 20_000;

async function fetchLivePrice(symbol: string, signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; TreasuryIQ/1.0)" }, signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const banks = (await getAllBankData()).filter((b) => b.marketData);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  const quotes: Quote[] = await Promise.all(
    banks.map(async (b): Promise<Quote> => {
      const md = b.marketData!;
      const live = await fetchLivePrice(md.yahooSymbol, controller.signal);
      const price = live ?? md.refClosePrice;
      return {
        bankId: b.bankId,
        ticker: b.ticker,
        yahooSymbol: md.yahooSymbol,
        bookValuePerShare: md.bookValuePerShare,
        price: Math.round(price * 100) / 100,
        priceToBook: Math.round((price / md.bookValuePerShare) * 100) / 100,
        live: live != null,
        asOfClose: live != null ? undefined : md.refCloseDate,
      };
    })
  );
  clearTimeout(timer);

  const anyLive = quotes.some((q) => q.live);
  const body = {
    asOf: new Date().toISOString(),
    live: anyLive,
    source: anyLive
      ? "Live price: Yahoo Finance (TSX, ~15-min delayed). Book value per share: Q2 2026 disclosures."
      : "Fallback: disclosed quarter-end close (Apr 30, 2026) ÷ Q2 2026 book value per share.",
    quotes,
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
