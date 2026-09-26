import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, isActiveSection } from "../src/lib/admin-sections";

describe("admin area", () => {
  it("every section has its page (nothing to remember but /admin)", () => {
    expect(existsSync(new URL("../src/app/admin/page.tsx", import.meta.url))).toBe(true);
    for (const s of ADMIN_SECTIONS) {
      const path = s.href.split("?")[0]!;
      expect(existsSync(new URL(`../src/app${path}/page.tsx`, import.meta.url)), s.href).toBe(true);
      // Developer pages open in developer mode straight from the link (also in production).
      if (s.dev) expect(s.href).toContain("dev=1");
    }
    expect(ADMIN_SECTIONS.map((s) => s.title)).toEqual(["Fragen", "Kosten", "Survival-Bühne", "Sounds"]);
  });

  it("the current page is highlighted", () => {
    const [fragen, , survival] = ADMIN_SECTIONS;
    expect(isActiveSection(fragen!, "/admin/fragen")).toBe(true);
    expect(isActiveSection(survival!, "/dev/survival")).toBe(true);
    expect(isActiveSection(fragen!, "/admin")).toBe(false);
  });
});
