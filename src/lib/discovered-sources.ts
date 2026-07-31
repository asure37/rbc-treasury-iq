// URLs that the discovery endpoint has itself fetched and verified during this
// server's lifetime. The PDF proxy consults this alongside the dataset allowlist so
// an analyst can open a newly-found source in the in-app viewer, WITHOUT the proxy
// becoming an open SSRF relay: nothing lands here unless our own server already
// fetched it over https from a public host and confirmed the cited figure inside.
const registry = new Set<string>();
const MAX = 500;

export function registerDiscoveredSource(url: string): void {
  if (registry.size >= MAX) {
    // Drop the oldest entry — insertion order is preserved by Set.
    const oldest = registry.values().next().value;
    if (oldest) registry.delete(oldest);
  }
  registry.add(url);
}

export function isDiscoveredSource(url: string): boolean {
  return registry.has(url);
}

/** https only, and never a private/loopback/link-local host. */
export function isSafePublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  // literal IPs: block loopback, private ranges, link-local and unique-local v6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a === 169) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (h.includes(":")) return false; // bare IPv6 literal
  return true;
}
