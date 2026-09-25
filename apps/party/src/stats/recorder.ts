/**
 * Question statistics inside one room. The Durable Object reports room
 * changes; the recorder writes ONE upsert per question when its answers are
 * revealed, collects 👍/👎 and writes them when the question is over, and
 * handles the host's "⚠️ Stimmt nicht?". Never blocks the game – every
 * write runs in the background and errors are only logged.
 */
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import { progressOf } from "../progress";
import { fail, ok, type Result } from "../result";
import type { RoomRecord } from "../room-logic";
import { invalidateContentFilter } from "./content-filter";
import type { StatsStore } from "./store";
import { applyVote, voteCounts, type Vote } from "./votes";

export interface StatsRuntime {
  read(): RoomRecord | null;
  commit(room: RoomRecord): Promise<void>;
  store(): StatsStore | null;
  waitUntil(promise: Promise<unknown>): void;
  now(): number;
  registry?: ModuleRegistry;
}

/** "Rückgängig" for a report is possible this long. */
export const REPORT_UNDO_MS = 10_000;

export class StatsRecorder {
  private reported = new Map<string, number>();

  constructor(private readonly rt: StatsRuntime) {}

  private get registry() {
    return this.rt.registry ?? GAME_MODULES;
  }

  private write(label: string, task: (store: StatsStore) => Promise<void>) {
    const store = this.rt.store();
    if (!store) return;
    this.rt.waitUntil(
      task(store).catch((err) => {
        console.warn(`stats: ${label} failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
      }),
    );
  }

  roomChanged(prev: RoomRecord | null, next: RoomRecord) {
    const before = progressOf(prev, this.registry);
    const after = progressOf(next, this.registry);

    // 1. The answers of a question were just revealed → one upsert.
    if (after?.revealed && after.contentId && !(before?.key === after.key && before.revealed)) {
      const game = next.game!;
      const module = getModule(after.categoryId, this.registry);
      const stats = game.moduleState != null ? module?.toStats?.(game.moduleState) : null;
      if (stats) this.write("play", (store) => store.recordPlay(after.categoryId, stats, this.rt.now()));
    }

    // 2. The rated question is over (next question, scoreboard, …) → write the votes.
    const votes = next.questionVotes;
    if (votes && votes.contentId !== (after?.revealed ? after.contentId : null)) {
      const { up, down } = voteCounts(votes);
      this.write("votes", (store) => store.recordVotes(votes.categoryId, votes.contentId, up, down, this.rt.now()));
      this.rt.waitUntil(
        (async () => {
          const room = this.rt.read();
          if (room?.questionVotes?.contentId === votes.contentId) await this.rt.commit({ ...room, questionVotes: null });
        })(),
      );
    }
  }

  /** Current question, answers revealed – ratings and reports refer to it. */
  private currentRevealed(contentId: string) {
    const p = progressOf(this.rt.read(), this.registry);
    return p?.revealed && p.contentId === contentId ? p : null;
  }

  /** 👍 / 👎 from a player (reveal + leaderboard of the current question). */
  async rate(playerId: string, contentId: string, vote: Vote): Promise<Result<void>> {
    const room = this.rt.read();
    const p = this.currentRevealed(contentId);
    if (!room || !p) return fail("WRONG_PHASE");
    if (!room.players.some((pl) => pl.id === playerId)) return fail("UNKNOWN_PLAYER");
    await this.rt.commit({
      ...room,
      questionVotes: applyVote(room.questionVotes, { contentId, categoryId: p.categoryId }, playerId, vote),
    });
    return ok(undefined);
  }

  /** Host: "⚠️ Stimmt nicht?" → quarantined right away (not played again until reviewed). */
  report(contentId: string): Result<void> {
    const p = this.currentRevealed(contentId);
    if (!p) return fail("WRONG_PHASE");
    if (this.reported.has(contentId)) return ok(undefined);
    this.reported.set(contentId, this.rt.now());
    invalidateContentFilter();
    this.write("report", (store) => store.report(p.categoryId, contentId, this.rt.now()));
    return ok(undefined);
  }

  /** Host: "Rückgängig" within 10 s. */
  undoReport(contentId: string): Result<void> {
    const at = this.reported.get(contentId);
    if (at === undefined || this.rt.now() - at > REPORT_UNDO_MS) return fail("WRONG_PHASE");
    this.reported.delete(contentId);
    invalidateContentFilter();
    this.write("undo report", (store) => store.undoReport(contentId, this.rt.now()));
    return ok(undefined);
  }
}
