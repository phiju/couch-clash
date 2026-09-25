import { describe, expect, it } from "vitest";
import { CHANGELOG, type ChangelogEntry } from "../src/content/changelog";
import { compareVersions, formatReleaseDate, isSemver, shortVersion, whatsNew } from "../src/lib/changelog";

const TECH_TERMS = /\b(PR|API|Durable Object|D1|R2|Refactor|Bugfix|TTS|Worker|Deploy|Commit)\b/i;

describe("changelog data", () => {
  it("versions are valid semver, unique and sorted newest first", () => {
    const versions = CHANGELOG.map((e) => e.version);
    for (const v of versions) expect(isSemver(v), v).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    }
  });

  it("every entry has a date, a title and 1–6 short, non-technical items", () => {
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.trim()).not.toBe("");
      expect(e.items.length).toBeGreaterThanOrEqual(1);
      expect(e.items.length).toBeLessThanOrEqual(6);
      for (const item of e.items) {
        expect(item.emoji.trim()).not.toBe("");
        expect(item.text.split(/\s+/).length, item.text).toBeLessThanOrEqual(14);
        expect(item.text, item.text).not.toMatch(TECH_TERMS);
      }
    }
  });
});

describe("changelog helpers", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.9.1", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.9.0")).toBe(0);
    expect(compareVersions("kaputt", "0.1.0")).toBeLessThan(0);
    expect(shortVersion("0.9.0")).toBe("0.9");
    expect(shortVersion("0.9.1")).toBe("0.9.1");
    expect(formatReleaseDate("2026-09-25")).toBe("25. September 2026");
  });

  const entry = (version: string): ChangelogEntry => ({ version, date: "2026-01-01", title: version, items: [{ emoji: "✨", text: "x" }] });
  const log = ["0.6.0", "0.5.0", "0.4.0", "0.3.0", "0.2.0"].map(entry);

  it("first visit: no popup, remember the newest version", () => {
    expect(whatsNew(null, log)).toEqual({ show: false, store: "0.6.0" });
  });

  it("up to date: nothing to do", () => {
    expect(whatsNew("0.6.0", log)).toEqual({ show: false, store: null });
  });

  it("shows the unseen versions, at most 3, then '… und mehr'", () => {
    const one = whatsNew("0.5.0", log);
    expect(one.show && one.entries.map((e) => e.version)).toEqual(["0.6.0"]);
    expect(one.show && one.more).toBe(false);
    const many = whatsNew("0.1.0", log);
    expect(many.show && many.entries.map((e) => e.version)).toEqual(["0.6.0", "0.5.0", "0.4.0"]);
    expect(many.show && many.more).toBe(true);
    // Garbage in storage counts as very old
    expect(whatsNew("???", log).show).toBe(true);
  });
});
