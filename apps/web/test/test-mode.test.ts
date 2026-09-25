import { describe, expect, it } from "vitest";
import { testModeEnabled } from "../src/lib/test-mode";

describe("test tools on the host screen", () => {
  it("only with ?test=1 or the admin token", () => {
    expect(testModeEnabled("", null)).toBe(false);
    expect(testModeEnabled("?test=0", undefined)).toBe(false);
    expect(testModeEnabled("?foo=1", null)).toBe(false);
    expect(testModeEnabled("?test=1", null)).toBe(true);
    expect(testModeEnabled("?a=b&test=1", null)).toBe(true);
    expect(testModeEnabled("", "secret-admin-token")).toBe(true);
  });
});
