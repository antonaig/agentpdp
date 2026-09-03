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

/**
 * Signatures of common bot-protection interstitials. "hard" signatures only appear on a wall page; "soft" ones
 * (cookie names, bot-management scripts) also ship on normal pages, so they count only with an error status or a tiny body.
 */
const CHALLENGE_SIGNATURES: { vendor: string; re: RegExp; soft?: boolean }[] = [
  { vendor: "Akamai", re: /errors\.edgesuite\.net|<title>\s*Access Denied\s*<\/title>|Reference&#32;&#35;\d/i },
  { vendor: "Akamai", re: /_abck|ak_bmsc|bm_sz/i, soft: true },
  { vendor: "Cloudflare", re: /<title>\s*Just a moment\.\.\.\s*<\/title>|Attention Required!\s*\|\s*Cloudflare|cf-browser-verification|cf_chl_opt/i },
  { vendor: "Cloudflare", re: /cf-chl|__cf_chl|challenge-platform|cdn-cgi\/challenge/i, soft: true },
  { vendor: "PerimeterX", re: /px-captcha|Please verify you are a human|Press & Hold to confirm you are/i },
  { vendor: "PerimeterX", re: /_pxAppId|perimeterx|human-challenge/i, soft: true },
  { vendor: "DataDome", re: /captcha-delivery\.com|geo\.captcha-delivery/i },
  { vendor: "DataDome", re: /datadome/i, soft: true },
  { vendor: "Imperva", re: /_Incapsula_Resource|Request unsuccessful\. Incapsula/i },
  { vendor: "Imperva", re: /incapsula/i, soft: true },
  { vendor: "Kasada", re: /kpsdk|ips\.js\?/i, soft: true },
  { vendor: "Distil", re: /Pardon Our Interruption|distil_r_captcha/i },
  { vendor: "F5/Shape", re: /TSPD_101|Please enable JavaScript to view the page content/i, soft: true },
];

/** Returns the vendor name when the body looks like a bot-challenge page, else null. */
export function detectBotChallenge(text: string, status: number): string | null {
  const head = text.slice(0, 200_000);
  const suspicious = status >= 400 || head.length < 20_000;
  for (const sig of CHALLENGE_SIGNATURES) {
    if (!sig.re.test(head)) continue;
    if (!sig.soft || suspicious) return sig.vendor;
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
