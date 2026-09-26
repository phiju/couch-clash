/** Cost data in D1 (binding STATS): measured calls per day and the fixed monthly costs. */
import type { CostUsageRow, FixedCost, FixedCostInput } from "@couch-clash/shared";
import type { RecordUsage, UsageEntry } from "./meter";

export interface CostStore {
  addUsage(day: string, entry: UsageEntry): Promise<void>;
  usageSince(day: string): Promise<CostUsageRow[]>;
  listFixed(): Promise<FixedCost[]>;
  addFixed(cost: FixedCostInput): Promise<void>;
  updateFixed(id: number, cost: FixedCostInput): Promise<boolean>;
  deleteFixed(id: number): Promise<boolean>;
}

interface UsageDbRow {
  day: string;
  service: string;
  kind: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  units: number;
  usd: number;
}

export function d1CostStore(db: D1Database): CostStore {
  return {
    async addUsage(day, e) {
      await db
        .prepare(
          `INSERT INTO api_usage (day, service, kind, calls, input_tokens, output_tokens, units, usd)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (day, service, kind) DO UPDATE SET
             calls = calls + excluded.calls,
             input_tokens = input_tokens + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             units = units + excluded.units,
             usd = usd + excluded.usd`,
        )
        .bind(day, e.service, e.kind, e.calls, e.inputTokens, e.outputTokens, e.units, e.usd)
        .run();
    },
    async usageSince(day) {
      const { results } = await db.prepare("SELECT * FROM api_usage WHERE day >= ?1 ORDER BY day").bind(day).all<UsageDbRow>();
      return results.map((r) => ({
        day: r.day,
        service: r.service as CostUsageRow["service"],
        kind: r.kind as CostUsageRow["kind"],
        calls: r.calls,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        units: r.units,
        usd: r.usd,
      }));
    },
    async listFixed() {
      const { results } = await db.prepare("SELECT * FROM fixed_costs ORDER BY since, id").all<FixedCost>();
      return results.map((r) => ({ ...r, currency: r.currency === "USD" ? "USD" : "EUR" }));
    },
    async addFixed(c) {
      await db
        .prepare("INSERT INTO fixed_costs (name, amount, currency, since, until, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(c.name, c.amount, c.currency, c.since, c.until, c.note)
        .run();
    },
    async updateFixed(id, c) {
      const res = await db
        .prepare("UPDATE fixed_costs SET name = ?2, amount = ?3, currency = ?4, since = ?5, until = ?6, note = ?7 WHERE id = ?1")
        .bind(id, c.name, c.amount, c.currency, c.since, c.until, c.note)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },
    async deleteFixed(id) {
      const res = await db.prepare("DELETE FROM fixed_costs WHERE id = ?1").bind(id).run();
      return (res.meta.changes ?? 0) > 0;
    },
  };
}

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Records into D1 in the background (waitUntil). Without a database nothing
 * is recorded; a failed write only logs – the game never notices.
 */
export function usageRecorder(store: CostStore | null, waitUntil: (p: Promise<unknown>) => void, now: () => number = Date.now): RecordUsage {
  return (entry) => {
    if (!store) return;
    waitUntil(
      store.addUsage(utcDay(now()), entry).catch(() => {
        console.warn("cost recording failed");
      }),
    );
  };
}
