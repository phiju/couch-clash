import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig(siteUrl: string | undefined) {
  vi.resetModules();
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  return import("../src/lib/config");
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.unstubAllGlobals();
});

describe("join URL", () => {
  it("uses NEXT_PUBLIC_SITE_URL for the QR code and the TV link", async () => {
    vi.stubGlobal("window", { location: { origin: "https://couch-clash-abc123-phiju.vercel.app" } });
    const config = await loadConfig("https://couch-clash-web.vercel.app/");
    expect(config.joinUrl("ABCD")).toBe("https://couch-clash-web.vercel.app/join/ABCD");
    expect(config.displayJoinLink()).toBe("couch-clash-web.vercel.app/join");
  });

  it("adds https:// if the variable has no protocol", async () => {
    const config = await loadConfig("couch-clash-web.vercel.app");
    expect(config.joinUrl("ABCD")).toBe("https://couch-clash-web.vercel.app/join/ABCD");
  });

  it("falls back to the current origin (local dev)", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
    const config = await loadConfig(undefined);
    expect(config.joinUrl("WXYZ")).toBe("http://localhost:3000/join/WXYZ");
    expect(config.displayJoinLink()).toBe("localhost:3000/join");
  });
});
