/**
 * What Couch Clash costs: every paid API call is measured by the party
 * server (per day and kind), fixed monthly costs (subscriptions such as
 * Claude or ElevenLabs) are entered by hand in "/admin/kosten".
 * Pure helpers here; the page and the worker share them.
 */
import type { AccountUsage } from "./voice";

/** What a measured call was for. */
export const COST_KINDS = [
  "avatar-round",
  "avatar-face",
  "avatar-figure",
  "voice-text",
  "voice-speech",
  "question-generate",
  "module-task",
] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_KIND_LABELS: Record<CostKind, string> = {
  "avatar-round": "📸 Foto-Avatar (rund)",
  "avatar-face": "😮 Gesichter für die Rangliste",
  "avatar-figure": "🧍 Stehende Figuren",
  "voice-text": "💬 Moderator-Texte",
  "voice-speech": "🎙️ Moderator-Stimme",
  "question-generate": "❓ Ersatzfragen",
  "module-task": "🔍 KI-Prüfung im Spiel",
};

export type CostService = "openai" | "elevenlabs";

/** One day × service × kind, summed up. `units`: ElevenLabs credits (their price is in the subscription). */
export interface CostUsageRow {
  day: string;
  service: CostService;
  kind: CostKind;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  usd: number;
}

export type CostCurrency = "EUR" | "USD";

/** A fixed monthly cost, e.g. "Claude Max" 100 €/month from 2026-05. */
export interface FixedCost {
  id: number;
  name: string;
  /** Per month. */
  amount: number;
  currency: CostCurrency;
  /** First month it counts ("YYYY-MM"). */
  since: string;
  /** Last month it counts ("YYYY-MM"), null = still running. */
  until: string | null;
  note: string | null;
}

export type FixedCostInput = Omit<FixedCost, "id">;

export interface AdminCostsResponse {
  usage: CostUsageRow[];
  fixed: FixedCost[];
  /** ElevenLabs credits this month (the real account numbers), null if unknown. */
  elevenlabs: AccountUsage | null;
  usdToEur: number;
}

/** Everything is shown in euros; OpenAI bills in dollars. Fixed rate – good enough for an overview. */
export const COST_CONFIG = { usdToEur: 0.86 } as const;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthOf = (day: string) => day.slice(0, 7);

export function toEur(amount: number, currency: CostCurrency, usdToEur: number): number {
  return currency === "USD" ? amount * usdToEur : amount;
}

/** Does a fixed cost count in this month? */
export function fixedCostActive(cost: Pick<FixedCost, "since" | "until">, month: string): boolean {
  return cost.since <= month && (cost.until === null || cost.until >= month);
}

export interface MonthCosts {
  month: string;
  /** Measured API costs in € per kind (only kinds that occurred). */
  byKind: { kind: CostKind; calls: number; units: number; eur: number }[];
  measuredEur: number;
  fixed: { cost: FixedCost; eur: number }[];
  fixedEur: number;
  totalEur: number;
  /** Photo avatars made (round ones) and what one costs on average incl. faces and figures. */
  avatars: number;
  eurPerAvatar: number | null;
}

/** Sums one month: measured costs per kind + the fixed costs that run in it. */
export function monthCosts(data: Pick<AdminCostsResponse, "usage" | "fixed" | "usdToEur">, month: string): MonthCosts {
  const byKind = new Map<CostKind, { kind: CostKind; calls: number; units: number; eur: number }>();
  for (const row of data.usage) {
    if (monthOf(row.day) !== month) continue;
    const entry = byKind.get(row.kind) ?? { kind: row.kind, calls: 0, units: 0, eur: 0 };
    entry.calls += row.calls;
    entry.units += row.units;
    entry.eur += row.usd * data.usdToEur;
    byKind.set(row.kind, entry);
  }
  const kinds = COST_KINDS.flatMap((k) => (byKind.has(k) ? [byKind.get(k)!] : []));
  const measuredEur = kinds.reduce((s, k) => s + k.eur, 0);
  const fixed = data.fixed
    .filter((c) => fixedCostActive(c, month))
    .map((cost) => ({ cost, eur: toEur(cost.amount, cost.currency, data.usdToEur) }));
  const fixedEur = fixed.reduce((s, f) => s + f.eur, 0);
  const avatars = byKind.get("avatar-round")?.calls ?? 0;
  const avatarEur = (["avatar-round", "avatar-face", "avatar-figure"] as const).reduce((s, k) => s + (byKind.get(k)?.eur ?? 0), 0);
  return {
    month,
    byKind: kinds,
    measuredEur,
    fixed,
    fixedEur,
    totalEur: measuredEur + fixedEur,
    avatars,
    eurPerAvatar: avatars > 0 ? avatarEur / avatars : null,
  };
}

/** Measured € per day for the last `days` days up to `today` (days without calls = 0). */
export function dailyCosts(data: Pick<AdminCostsResponse, "usage" | "usdToEur">, today: string, days = 30): { day: string; eur: number }[] {
  const sums = new Map<string, number>();
  for (const row of data.usage) sums.set(row.day, (sums.get(row.day) ?? 0) + row.usd * data.usdToEur);
  const end = Date.parse(`${today}T00:00:00Z`);
  const out: { day: string; eur: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, eur: sums.get(day) ?? 0 });
  }
  return out;
}

/** Every month from the first measured call or fixed cost up to the current one, newest first. */
export function costMonths(data: Pick<AdminCostsResponse, "usage" | "fixed">, currentMonth: string): string[] {
  let first = currentMonth;
  for (const row of data.usage) if (monthOf(row.day) < first) first = monthOf(row.day);
  for (const cost of data.fixed) if (cost.since < first) first = cost.since;
  const out: string[] = [];
  let [y, m] = currentMonth.split("-").map(Number) as [number, number];
  for (let month = currentMonth; month >= first && out.length < 120; ) {
    out.push(month);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    month = `${y}-${String(m).padStart(2, "0")}`;
  }
  return out;
}
