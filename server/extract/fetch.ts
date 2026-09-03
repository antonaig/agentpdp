/**
 * safeFetch(): SSRF-guarded GET with a two-step user-agent strategy.
 *
 * 1. Descriptive UA first (we identify ourselves).
 * 2. If the site answers 403 / 406 / 429 or serves a bot-challenge page, retry once with a current
 *    desktop Chrome UA and browser-like Accept headers.
 */
import { guardedFetch, type GuardedFetchOptions, type GuardedResponse } from "../security/ssrf.js";

export const DESCRIPTIVE_UA = "AgentPDP/0.1 (+https://github.com/antonaig/agentpdp)";
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const JSON_ACCEPT = "application/json,text/plain,*/*;q=0.8";

export function browserHeaders(accept = HTML_ACCEPT): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "no-cache",
  };
}

/** Signatures of common bot-protection interstitials. Matched case-insensitively on the first 200 KB. */
const CHALLENGE_SIGNATURES: { vendor: string; re: RegExp }[] = [
  { vendor: "Akamai", re: /errors\.edgesuite\.net|<title>\s*Access Denied\s*<\/title>|Reference&#32;&#35;\d|_abck/i },
  { vendor: "Cloudflare", re: /cf-chl|__cf_chl|challenge-platform|cf_chl_opt|<title>\s*Just a moment\.\.\.\s*<\/title>|Attention Required!\s*\|\s*Cloudflare|cf-browser-verification/i },
  { vendor: "PerimeterX", re: /_pxAppId|px-captcha|perimeterx|human-challenge|Please verify you are a human/i },
  { vendor: "DataDome", re: /datadome|captcha-delivery\.com|dd\.js"/i },
  { vendor: "Imperva", re: /_Incapsula_Resource|Request unsuccessful\. Incapsula|incapsula/i },
  { vendor: "Kasada", re: /kpsdk|ips\.js\?/i },
  { vendor: "Distil", re: /Pardon Our Interruption|distil_r_captcha/i },
  { vendor: "F5/Shape", re: /Please enable JavaScript to view the page content|TSPD_101/i },
];

/** Returns the vendor name when the body looks like a bot-challenge page, else null. */
export function detectBotChallenge(text: string, status: number): string | null {
  const head = text.slice(0, 200_000);
  for (const sig of CHALLENGE_SIGNATURES) {
    if (sig.re.test(head)) {
      // Real product pages can mention these vendors in inline scripts (e.g. Akamai _abck cookie code).
      // Only treat a match as a wall when the page is short or the status already says "no".
      const soft = /_abck|_pxAppId|kpsdk|datadome|incapsula/i.test(sig.re.source);
      if (!soft || status >= 400 || head.length < 20_000) return sig.vendor;
    }
  }
  if ((status === 403 || status === 503 || status === 429) && head.length < 20_000 && /captcha|verify|robot|blocked|denied|unusual traffic/i.test(head)) {
    return "unknown";
  }
  return null;
}

export interface SafeFetchResult extends GuardedResponse {
  attempts: number;
  /** vendor of the bot wall we hit, if the final response still looks like one */
  botChallenge: string | null;
  userAgent: string;
}

export interface SafeFetchOptions extends Omit<GuardedFetchOptions, "headers"> {
  accept?: "html" | "json";
  /** Start with the browser UA (skip the descriptive attempt). */
  browserFirst?: boolean;
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const accept = opts.accept === "json" ? JSON_ACCEPT : HTML_ACCEPT;
  const started = Date.now();
  const { accept: _a, browserFirst, ...guardOpts } = opts;

  const asBrowser = async (attempts: number): Promise<SafeFetchResult> => {
    const res = await guardedFetch(url, { ...guardOpts, headers: browserHeaders(accept) });
    return { ...res, ms: Date.now() - started, attempts, botChallenge: detectBotChallenge(res.text, res.status), userAgent: BROWSER_UA };
  };

  if (browserFirst) return asBrowser(1);

  const first = await guardedFetch(url, {
    ...guardOpts,
    headers: { "User-Agent": DESCRIPTIVE_UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
  });
  const challenge = detectBotChallenge(first.text, first.status);
  const retry = challenge !== null || [403, 406, 429, 503].includes(first.status);
  if (!retry) return { ...first, ms: Date.now() - started, attempts: 1, botChallenge: null, userAgent: DESCRIPTIVE_UA };
  return asBrowser(2);
}
