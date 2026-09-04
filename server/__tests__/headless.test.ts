import { describe, it, expect } from "vitest";
import { MAX_PENDING, shouldAllowHeadlessRequest } from "../extract/headless.js";

const publicLookup = async () => ["93.184.216.34"];
const privateLookup = async () => ["10.0.0.7"];

describe("headless route decision", () => {
  it("refuses anything that is not https, whatever the resolver says", async () => {
    expect(await shouldAllowHeadlessRequest("http://127.0.0.1:8787/healthz", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("http://169.254.169.254/latest/meta-data/", "fetch", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("http://www.example.com/", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("ws://www.example.com/socket", "websocket", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("file:///etc/passwd", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("chrome://version", "document", publicLookup)).toBe(false);
  });

  it("skips heavy assets even on public https hosts", async () => {
    expect(await shouldAllowHeadlessRequest("https://cdn.example.com/hero.jpg", "image", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://cdn.example.com/clip.mp4", "media", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://cdn.example.com/font.woff2", "font", publicLookup)).toBe(false);
  });

  it("allows https to a public host", async () => {
    expect(await shouldAllowHeadlessRequest("https://www.example.com/products/x", "document", publicLookup)).toBe(true);
    expect(await shouldAllowHeadlessRequest("https://www.example.com/api/product.json", "fetch", publicLookup)).toBe(true);
    expect(await shouldAllowHeadlessRequest("https://www.example.com/app.js", "script", publicLookup)).toBe(true);
  });

  it("refuses https when the host resolves to a private address or is a private literal", async () => {
    expect(await shouldAllowHeadlessRequest("https://internal.example.com/", "fetch", privateLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://internal.example.com/", "document", async () => ["93.184.216.34", "::1"])).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://127.0.0.1/", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://[::1]/", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://169.254.169.254/", "xhr", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://localhost/", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://www.example.com:8443/", "document", publicLookup)).toBe(false);
    expect(await shouldAllowHeadlessRequest("https://user:pw@www.example.com/", "document", publicLookup)).toBe(false);
  });

  it("caps the wait line at a small constant", () => {
    expect(MAX_PENDING).toBe(3);
  });
});
