import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { d1StatsStore, type StatsStore } from "../src/stats/store";

/** Minimal D1 on top of node:sqlite, with the real migration applied. */
export function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_question_stats.sql", import.meta.url), "utf8"));
  const statement = (sql: string, args: unknown[] = []) => {
    const run = () => {
      const res = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(res.changes) } };
    };
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      run: async () => run(),
      all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
      first: async () => {
        const row = db.prepare(sql).get(...args);
        return row ? { ...row } : null;
      },
      _run: run,
    };
  };
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return { db, d1: d1 as unknown as D1Database };
}

export function sqliteStore(): { store: StatsStore; db: DatabaseSync } {
  const { db, d1 } = sqliteD1();
  return { store: d1StatsStore(d1), db };
}

/** A store whose every call fails (D1 down). */
export function brokenStore(): StatsStore {
  const fail = async () => {
    throw new Error("D1_ERROR: network connection lost");
  };
  return new Proxy({} as StatsStore, { get: () => fail });
}
