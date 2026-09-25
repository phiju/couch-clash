/**
 * Test bots: decides WHEN a bot acts (the module decides what). After every
 * room change the driver asks the flow for the bots' moves in the current
 * step and schedules each one after a short random delay (1–6 s). A bot acts
 * at most once per step; a move that became invalid meanwhile (step over,
 * already answered) is just dropped – bots never block: the step timers
 * move the game on anyway.
 *
 * Timers live in memory (a test tool): if the room object is evicted, the
 * pending moves are lost and the step timer ends the step.
 */
import { botDelayMs } from "@couch-clash/shared";
import { botMoves, handlePlayerAction, type FlowDeps } from "./game-flow";
import type { RoomRecord } from "./room-logic";

export interface BotRuntime {
  read(): RoomRecord | null;
  commit(room: RoomRecord): Promise<void>;
  flowDeps(): FlowDeps;
  /** Keeps the object alive while a move is pending. */
  waitUntil(promise: Promise<unknown>): void;
  random(): number;
  /** Injectable for tests. */
  delay?(ms: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BotDriver {
  /** "botId|stepKey" of moves already scheduled. */
  private scheduled = new Set<string>();

  constructor(private readonly rt: BotRuntime) {}

  roomChanged(room: RoomRecord) {
    if (!room.players.some((p) => p.bot)) return;
    const pending = botMoves(room, this.rt.flowDeps());
    if (!pending) {
      this.scheduled.clear();
      return;
    }
    for (const { botId } of pending.moves) {
      const id = `${botId}|${pending.key}`;
      if (this.scheduled.has(id)) continue;
      this.scheduled.add(id);
      this.rt.waitUntil(this.act(botId, pending.key, botDelayMs(this.rt.random)));
    }
  }

  private async act(botId: string, key: string, ms: number) {
    await (this.rt.delay ?? sleep)(ms);
    const room = this.rt.read();
    if (!room) return;
    // Re-ask: the step may be over or the bot's move no longer valid.
    const now = botMoves(room, this.rt.flowDeps());
    const move = now?.key === key ? now.moves.find((m) => m.botId === botId) : undefined;
    if (!move) return;
    const result = handlePlayerAction(room, botId, move.action, this.rt.flowDeps());
    if (result.ok) await this.rt.commit(result.value);
  }
}
