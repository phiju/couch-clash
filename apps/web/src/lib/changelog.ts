/** Pure helpers for the release notes (tested). */
import { CHANGELOG, type ChangelogEntry } from "../content/changelog";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isSemver(version: string): boolean {
  return SEMVER.test(version);
}

/** < 0 when a is older than b, 0 when equal, > 0 when newer. Invalid versions count as oldest. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (isSemver(v) ? v.split(".").map(Number) : [-1, -1, -1]);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/** "0.9.0" → "0.9", "0.9.1" → "0.9.1" */
export function shortVersion(version: string): string {
  return version.endsWith(".0") ? version.slice(0, -2) : version;
}

export const CURRENT_VERSION = CHANGELOG[0]!.version;

export const MAX_POPUP_VERSIONS = 3;

export type WhatsNewDecision =
  | { show: false; store: string | null }
  | { show: true; entries: ChangelogEntry[]; more: boolean };

/**
 * What the start page does with the stored "last seen" version:
 * first visit (nothing stored) → no popup, just remember the current version;
 * older → show the versions not seen yet (at most 3, then "… und mehr").
 */
export function whatsNew(lastSeen: string | null, changelog: readonly ChangelogEntry[] = CHANGELOG): WhatsNewDecision {
  const newest = changelog[0]?.version;
  if (!newest) return { show: false, store: null };
  if (lastSeen === null) return { show: false, store: newest };
  const unseen = changelog.filter((e) => compareVersions(e.version, lastSeen) > 0);
  if (unseen.length === 0) return { show: false, store: null };
  return { show: true, entries: unseen.slice(0, MAX_POPUP_VERSIONS), more: unseen.length > MAX_POPUP_VERSIONS };
}

/** "25. September 2026" */
export function formatReleaseDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
