import { getAllBankData } from "@/lib/data";
import { isDiscoveredSource, isSafePublicHttpUrl } from "@/lib/discovered-sources";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fetches a source PDF server-side so the client-side viewer isn't blocked by
// third-party CORS restrictions. Only ever proxies URLs that actually appear
// somewhere in our own dataset — never an arbitrary caller-supplied URL —
// to avoid this becoming an open SSRF proxy.
let allowedCache: { at: number; urls: Set<string> } | null = null;
const ALLOWLIST_TTL = 5 * 60 * 1000;

async function buildAllowedUrlSet(): Promise<Set<string>> {
  // Memoized: an evidence-pack export fires this once per source document, and
  // re-parsing ~500 KB of bank JSON in front of every upstream fetch is pure latency.
  if (allowedCache && Date.now() - allowedCache.at < ALLOWLIST_TTL) return allowedCache.urls;
  const banks = await getAllBankData();
  const urls = new Set<string>();
  for (const bank of banks) {
    if (bank.irrbbDisclosureSourceUrl) urls.add(bank.irrbbDisclosureSourceUrl);
    for (const q of bank.quarters) {
      urls.add(q.reportUrl);
      if (q.supplementaryReportUrl) urls.add(q.supplementaryReportUrl);
      if (q.sourceRefs) {
        for (const ref of Object.values(q.sourceRefs)) {
          if (ref?.url) urls.add(ref.url);
        }
      }
    }
  }
  allowedCache = { at: Date.now(), urls };
  return urls;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");
  if (!target) {
    return new Response("Missing url parameter", { status: 400 });
  }

  // Either a URL from our own dataset, or one the discovery endpoint already fetched
  // and verified this session (it only registers public https documents in which it
  // actually located the cited figure) — so this never becomes an open SSRF relay.
  const allowed = await buildAllowedUrlSet();
  if (!allowed.has(target) && !(isDiscoveredSource(target) && isSafePublicHttpUrl(target))) {
    return new Response("URL not recognized as a dataset or verified source", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TreasuryIQ-Dashboard/1.0)" } });
  } catch {
    return new Response("Failed to fetch source document", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("Source document unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
