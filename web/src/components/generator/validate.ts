export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Accepts what people paste: with or without a scheme, with trailing hash. Rejects anything that is not an http(s) page
 * with a real host. http is upgraded to https (the extraction API only fetches https).
 */
export function normalizeProductUrl(input: string): UrlCheck {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Paste a product page URL." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, error: "That is not a URL we can read. Use the full address, like https://store.com/products/name." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "Only http and https pages are supported." };
  if (!u.hostname || !u.hostname.includes(".")) return { ok: false, error: "The URL needs a host, like store.com." };
  u.protocol = "https:";
  u.hash = "";
  return { ok: true, url: u.toString() };
}
