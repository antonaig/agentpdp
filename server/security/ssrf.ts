/**
 * SSRF guard for outbound fetches.
 *
 * validateTargetUrl(): https only (http input is upgraded), no userinfo, no non-default port,
 * no IP-literal or DNS-resolved address in private / loopback / link-local / multicast / CGNAT /
 * IPv6 ULA + link-local ranges, no .local / .internal / localhost names.
 *
 * guardedFetch(): follows redirects manually (max 5), re-validating every hop; aborts the body
 * stream past 5 MB; 8 s overall timeout via AbortController.
 *
 * Known limitation: the address is resolved once before the request, so a DNS-rebinding attacker
 * with a very short TTL could in theory swap records between our check and the socket connect.
 * Pinning the socket to the checked address needs a custom undici dispatcher; out of scope tonight.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ExtractErrorCode } from "../../shared/types.js";

export class GuardError extends Error {
  constructor(public code: ExtractErrorCode, message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export type LookupFn = (hostname: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".localdomain", ".home.arpa"];
const BLOCKED_NAMES = new Set(["localhost", "localhost6", "ip6-localhost", "broadcasthost"]);

// ---- IP classification ----

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inV4Cidr(ipInt: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const baseInt = v4ToInt(base)!;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

const BLOCKED_V4 = [
  "0.0.0.0/8",        // "this" network
  "10.0.0.0/8",       // private
  "100.64.0.0/10",    // CGNAT
  "127.0.0.0/8",      // loopback
  "169.254.0.0/16",   // link-local (cloud metadata lives here)
  "172.16.0.0/12",    // private
  "192.0.0.0/24",     // IETF protocol assignments
  "192.0.2.0/24",     // TEST-NET-1
  "192.88.99.0/24",   // 6to4 relay (deprecated)
  "192.168.0.0/16",   // private
  "198.18.0.0/15",    // benchmarking
  "198.51.100.0/24",  // TEST-NET-2
  "203.0.113.0/24",   // TEST-NET-3
  "224.0.0.0/4",      // multicast
  "240.0.0.0/4",      // reserved + broadcast
];

export function isBlockedIPv4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // unparseable → refuse
  return BLOCKED_V4.some((c) => inV4Cidr(n, c));
}

/** Expand an IPv6 address into 8 16-bit groups. Handles :: and embedded IPv4 tails. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = v4ToInt(tail);
    if (v4 === null) return null;
    s = s.slice(0, lastColon + 1) + ((v4 >>> 16) & 0xffff).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...rest].map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return NaN;
    return parseInt(g, 16);
  });
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZero = g.every((x) => x === 0);
  if (allZero) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d and NAT64 64:ff9b::/96 → check embedded v4
  const embedsV4 =
    (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) ||
    (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0));
  if (embedsV4) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isBlockedIPv4(v4);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x2002) {
    // 6to4: embedded v4 in groups 1-2
    const v4 = `${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`;
    return isBlockedIPv4(v4);
  }
  return false;
}

export function isBlockedAddress(addr: string): boolean {
  const bare = addr.startsWith("[") && addr.endsWith("]") ? addr.slice(1, -1) : addr;
  const kind = isIP(bare);
  if (kind === 4) return isBlockedIPv4(bare);
  if (kind === 6) return isBlockedIPv6(bare);
  return true;
}

// ---- URL validation ----

export interface ValidatedTarget {
  url: URL;
  addresses: string[];
}

/**
 * Parse + validate a user-supplied URL. Returns the https URL to fetch and the addresses it resolved to.
 * Throws GuardError("invalid_url") for garbage and GuardError("ssrf_blocked") for anything pointing inside.
 */
export async function validateTargetUrl(input: string, lookup: LookupFn = defaultLookup): Promise<ValidatedTarget> {
  let url: URL;
  try {
    const trimmed = input.trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new GuardError("invalid_url", "Not a valid URL");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new GuardError("invalid_url", `Only https URLs are supported (got ${url.protocol})`);
  if (url.username || url.password) throw new GuardError("ssrf_blocked", "URLs with credentials are not allowed");
  if (url.port && url.port !== "443") throw new GuardError("ssrf_blocked", "Only the default https port is allowed");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new GuardError("invalid_url", "URL has no host");
  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new GuardError("ssrf_blocked", `Host "${host}" is not allowed`);
  }
  // WHATWG URL parsing already normalizes decimal / hex / octal IPv4 forms to dotted quad, so an
  // IP literal in any spelling reaches this check as "127.0.0.1" style or "[::1]".
  const bareHost = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIP(bareHost)) {
    if (isBlockedAddress(bareHost)) throw new GuardError("ssrf_blocked", "IP address targets inside private or reserved ranges are not allowed");
    return { url, addresses: [bareHost] };
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new GuardError("invalid_url", `Host "${host}" is not a public hostname`);

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch (err) {
    throw new GuardError("fetch_failed", `DNS lookup failed for ${host}: ${(err as Error).message}`);
  }
  if (addresses.length === 0) throw new GuardError("fetch_failed", `DNS lookup returned no addresses for ${host}`);
  const bad = addresses.find((a) => isBlockedAddress(a));
  if (bad) throw new GuardError("ssrf_blocked", `Host "${host}" resolves to a non-public address`);
  return { url, addresses };
}

// ---- Guarded fetch ----

export interface GuardedResponse {
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  text: string;
  ms: number;
  redirects: number;
}

export interface GuardedFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
}

function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType ?? "");
  const label = m?.[1]?.toLowerCase();
  if (label && label !== "utf-8" && label !== "utf8") {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unknown label → utf-8 below
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * GET a validated URL with manual redirect handling, a byte cap and a timeout.
 * Every redirect target goes back through validateTargetUrl().
 */
export async function guardedFetch(input: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new GuardError("timeout", `Timed out after ${timeoutMs} ms`)), timeoutMs);

  try {
    let current = (await validateTargetUrl(input, opts.lookup)).url;
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetchImpl(current.href, { method: "GET", headers: opts.headers, redirect: "manual", signal: ac.signal });
      } catch (err) {
        if (ac.signal.aborted) throw ac.signal.reason instanceof GuardError ? ac.signal.reason : new GuardError("timeout", "Timed out");
        throw new GuardError("fetch_failed", `Request to ${current.host} failed: ${(err as Error).message}`);
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new GuardError("fetch_failed", `Redirect (${res.status}) without a Location header`);
        if (hop >= maxRedirects) throw new GuardError("fetch_failed", `Too many redirects (>${maxRedirects})`);
        await res.body?.cancel().catch(() => {});
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          throw new GuardError("fetch_failed", `Redirect to an invalid URL: ${loc}`);
        }
        current = (await validateTargetUrl(next.href, opts.lookup)).url;
        continue;
      }

      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new GuardError("too_large", `Response is ${declared} bytes; limit is ${maxBytes}`);
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const chunk = await reader.read().catch((err: unknown) => {
            if (ac.signal.aborted) throw ac.signal.reason instanceof GuardError ? ac.signal.reason : new GuardError("timeout", "Timed out reading body");
            throw new GuardError("fetch_failed", `Body read failed: ${(err as Error).message}`);
          });
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            ac.abort(new GuardError("too_large", "Response exceeded size cap"));
            throw new GuardError("too_large", `Response exceeded ${maxBytes} bytes; aborted`);
          }
          chunks.push(chunk.value);
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: res.status,
        finalUrl: current.href,
        headers,
        text: decodeBody(bytes, headers["content-type"]),
        ms: Date.now() - started,
        redirects: hop,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
