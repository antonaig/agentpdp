import { describe, it, expect } from "vitest";
import { GuardError, guardedFetch, isBlockedIPv4, isBlockedIPv6, validateTargetUrl } from "../security/ssrf.js";

const publicLookup = async () => ["93.184.216.34"];

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof GuardError ? err.code : `other:${(err as Error).message}`;
  }
}

describe("validateTargetUrl", () => {
  it("accepts https and upgrades http", async () => {
    const a = await validateTargetUrl("https://www.brooklinen.com/products/x", publicLookup);
    expect(a.url.href).toBe("https://www.brooklinen.com/products/x");
    const b = await validateTargetUrl("http://www.brooklinen.com/products/x", publicLookup);
    expect(b.url.protocol).toBe("https:");
    const c = await validateTargetUrl("www.brooklinen.com/products/x", publicLookup);
    expect(c.url.href).toBe("https://www.brooklinen.com/products/x");
  });

  it("rejects non-http schemes, userinfo, non-default ports", async () => {
    expect(await code(validateTargetUrl("ftp://example.com/x", publicLookup))).toBe("invalid_url");
    expect(await code(validateTargetUrl("file:///etc/passwd", publicLookup))).toBe("invalid_url");
    expect(await code(validateTargetUrl("https://user:pw@example.com/", publicLookup))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://user@example.com/", publicLookup))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://example.com:8443/", publicLookup))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://example.com:443/", publicLookup))).toBe("ok");
    expect(await code(validateTargetUrl("not a url", publicLookup))).toBe("invalid_url");
    expect(await code(validateTargetUrl("", publicLookup))).toBe("invalid_url");
  });

  it("rejects local-ish hostnames", async () => {
    for (const h of ["localhost", "LOCALHOST", "foo.localhost", "printer.local", "api.internal", "db.corp.internal", "host.localdomain", "x.home.arpa"]) {
      expect(await code(validateTargetUrl(`https://${h}/`, publicLookup)), h).toBe("ssrf_blocked");
    }
  });

  it("rejects IPv4 literals in every spelling", async () => {
    const cases: Record<string, string> = {
      "127.0.0.1": "loopback",
      "127.1": "short loopback",
      "2130706433": "decimal loopback",
      "0x7f000001": "hex loopback",
      "0x7f.0.0.1": "mixed hex",
      "0177.0.0.1": "octal loopback",
      "017700000001": "octal int",
      "10.0.0.1": "private 10/8",
      "172.16.5.5": "private 172.16/12",
      "172.31.255.255": "private 172.16/12 top",
      "192.168.1.1": "private 192.168/16",
      "169.254.169.254": "link-local / metadata",
      "100.64.0.1": "CGNAT",
      "100.127.255.254": "CGNAT top",
      "224.0.0.1": "multicast",
      "255.255.255.255": "broadcast",
      "0.0.0.0": "this network",
      "192.0.0.1": "IETF",
      "198.18.0.1": "benchmarking",
    };
    for (const [ip, why] of Object.entries(cases)) {
      expect(await code(validateTargetUrl(`https://${ip}/`, publicLookup)), `${ip} (${why})`).toBe("ssrf_blocked");
    }
    expect(await code(validateTargetUrl("https://93.184.216.34/", publicLookup))).toBe("ok");
    expect(await code(validateTargetUrl("https://172.32.0.1/", publicLookup))).toBe("ok"); // just outside 172.16/12
  });

  it("rejects IPv6 literals in private / special ranges", async () => {
    const blocked = ["::1", "::", "2001::1", "::ffff:0:127.0.0.1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "::127.0.0.1", "2001:db8::1", "2002:7f00:1::1"];
    for (const ip of blocked) expect(await code(validateTargetUrl(`https://[${ip}]/`, publicLookup)), ip).toBe("ssrf_blocked");
    expect(["ssrf_blocked", "invalid_url"]).toContain(await code(validateTargetUrl("https://[fe80::1%25en0]/", publicLookup))); // zone ids are refused either way
    expect(await code(validateTargetUrl("https://[2606:4700::1111]/", publicLookup))).toBe("ok");
    expect(await code(validateTargetUrl("https://[::ffff:93.184.216.34]/", publicLookup))).toBe("ok");
  });

  it("rejects hostnames that resolve to blocked addresses (any record)", async () => {
    expect(await code(validateTargetUrl("https://evil.example.com/", async () => ["127.0.0.1"]))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://evil.example.com/", async () => ["93.184.216.34", "10.0.0.5"]))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://evil.example.com/", async () => ["::1"]))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://evil.example.com/", async () => ["fd00::1"]))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://evil.example.com/", async () => ["169.254.169.254"]))).toBe("ssrf_blocked");
    expect(await code(validateTargetUrl("https://ok.example.com/", async () => ["93.184.216.34", "2606:4700::1111"]))).toBe("ok");
  });

  it("reports DNS failures as fetch_failed, not as a block", async () => {
    expect(await code(validateTargetUrl("https://nope.example.com/", async () => { throw new Error("ENOTFOUND"); }))).toBe("fetch_failed");
    expect(await code(validateTargetUrl("https://nope.example.com/", async () => []))).toBe("fetch_failed");
  });
});

describe("ip classifiers", () => {
  it("classifies edge addresses", () => {
    expect(isBlockedIPv4("172.15.255.255")).toBe(false);
    expect(isBlockedIPv4("172.16.0.0")).toBe(true);
    expect(isBlockedIPv4("100.63.255.255")).toBe(false);
    expect(isBlockedIPv4("100.128.0.0")).toBe(false);
    expect(isBlockedIPv4("not-an-ip")).toBe(true);
    expect(isBlockedIPv6("fbff::1")).toBe(false);
    expect(isBlockedIPv6("fc00::")).toBe(true);
    expect(isBlockedIPv6("garbage")).toBe(true);
  });

  it("blocks Teredo 2001::/32 but not its neighbours", () => {
    expect(isBlockedIPv6("2001::1")).toBe(true);
    expect(isBlockedIPv6("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
    expect(isBlockedIPv6("2001:1::1")).toBe(false);
    expect(isBlockedIPv6("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks IPv4-translated ::ffff:0:a.b.c.d by the embedded v4", () => {
    expect(isBlockedIPv6("::ffff:0:127.0.0.1")).toBe(true);
    expect(isBlockedIPv6("::ffff:0:7f00:1")).toBe(true);
    expect(isBlockedIPv6("::ffff:0:a9fe:a9fe")).toBe(true);
    expect(isBlockedIPv6("::ffff:0:93.184.216.34")).toBe(false);
  });
});

// ---- guardedFetch with a fake fetch ----

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}

describe("guardedFetch", () => {
  it("follows redirects manually and returns the final URL", async () => {
    const calls: string[] = [];
    const f = fakeFetch((url, init) => {
      calls.push(url);
      expect(init.redirect).toBe("manual");
      if (url === "https://a.example.com/") return new Response(null, { status: 301, headers: { location: "/b" } });
      if (url === "https://a.example.com/b") return new Response(null, { status: 302, headers: { location: "https://c.example.com/final" } });
      return new Response("<html>done</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-test": "1" } });
    });
    const res = await guardedFetch("http://a.example.com/", { fetchImpl: f, lookup: publicLookup });
    expect(calls).toEqual(["https://a.example.com/", "https://a.example.com/b", "https://c.example.com/final"]);
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("https://c.example.com/final");
    expect(res.text).toBe("<html>done</html>");
    expect(res.headers["x-test"]).toBe("1");
    expect(res.redirects).toBe(2);
  });

  it("re-validates every redirect hop", async () => {
    const f = fakeFetch((url) => {
      if (url === "https://a.example.com/") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      return new Response("secret", { status: 200 });
    });
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup }))).toBe("ssrf_blocked");

    const g = fakeFetch((url) => {
      if (url === "https://a.example.com/") return new Response(null, { status: 302, headers: { location: "https://internal-db.example.com/" } });
      return new Response("secret", { status: 200 });
    });
    const lookup = async (h: string) => (h === "internal-db.example.com" ? ["10.1.2.3"] : ["93.184.216.34"]);
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: g, lookup }))).toBe("ssrf_blocked");
  });

  it("stops after too many redirects", async () => {
    let n = 0;
    const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: `/hop${++n}` } }));
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup }))).toBe("fetch_failed");
    expect(n).toBe(6); // 1 initial + 5 redirects, then give up
  });

  it("aborts bodies over the size cap", async () => {
    const chunk = new Uint8Array(1024).fill(65);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
    });
    const f = fakeFetch(() => new Response(stream, { status: 200 }));
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup, maxBytes: 10 * 1024 }))).toBe("too_large");
    expect(pulls).toBeLessThan(40); // did not drain an endless stream
  });

  it("rejects declared content-length over the cap without reading", async () => {
    const f = fakeFetch(() => new Response("x", { status: 200, headers: { "content-length": String(6 * 1024 * 1024) } }));
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup }))).toBe("too_large");
  });

  it("times out via AbortController", async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
        }),
    );
    const t0 = Date.now();
    expect(await code(guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup, timeoutMs: 50 }))).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("decodes non-utf8 charsets from content-type", async () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
    const f = fakeFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "text/html; charset=iso-8859-1" } }));
    const res = await guardedFetch("https://a.example.com/", { fetchImpl: f, lookup: publicLookup });
    expect(res.text).toBe("café");
  });
});
