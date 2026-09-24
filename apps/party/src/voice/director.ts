/**
 * The host's voice inside one room. The Durable Object tells the director
 * what happened (player joined, room changed, host screen played a line);
 * the director decides what the host says and produces it in the
 * background. Nothing here ever delays the game.
 */
import { buildLeaderboard, type HostLine } from "@couch-clash/shared";
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import type { RoomRecord } from "../room-logic";
import { VOICE_CONFIG } from "./config";
import { commentPrompt, finalePrompt, sanitizeName, startPrompt, welcomePrompt, type CommentFacts } from "./prompt";
import {
  commentHighlights,
  commentPlayers,
  effectiveCheekiness,
  extendedPhaseEnd,
  planWelcomes,
  rememberTarget,
  shouldComment,
  updateStreaks,
  type RoomVoice,
} from "./rules";
import { produceLine, type ProducedLine, type VoiceServices } from "./service";
import { commentTemplate, finaleTemplate, startTemplate, welcomeTemplate } from "./templates";

export interface VoiceRuntime {
  /** The current, active room (null when expired). */
  read(): RoomRecord | null;
  /** Save + broadcast. */
  commit(room: RoomRecord): Promise<void>;
  /** Sends to host screens only. False if no host screen is connected. */
  sendToHosts(line: HostLine): boolean;
  hostConnected(): boolean;
  waitUntil(promise: Promise<unknown>): void;
  services(): VoiceServices;
  now(): number;
  random(): number;
  newId(): string;
  registry?: ModuleRegistry;
}

export type VoiceEvent =
  | { type: "game_start" }
  | { type: "reveal"; key: string; roundIndex: number; index: number; total: number }
  | { type: "leaderboard"; key: string }
  | { type: "finale" };

interface Progress {
  key: string;
  roundIndex: number;
  index: number;
  total: number;
  step: string;
}

export function progressOf(room: RoomRecord | null, registry: ModuleRegistry = GAME_MODULES): Progress | null {
  const game = room?.game;
  if (!room || room.phase !== "play" || !game || game.moduleState == null) return null;
  const round = game.rounds[game.roundIndex];
  const module = round ? getModule(round.categoryId, registry) : undefined;
  const p = module?.progress?.(game.moduleState);
  if (!p) return null;
  return { ...p, roundIndex: game.roundIndex, key: `${game.roundIndex}:${p.index}` };
}

/** What happened between two room states (for the voice). */
export function detectVoiceEvents(
  prev: RoomRecord | null,
  next: RoomRecord,
  registry: ModuleRegistry = GAME_MODULES,
): VoiceEvent[] {
  const events: VoiceEvent[] = [];
  if (prev && (prev.phase === "lobby" || prev.phase === "setup") && next.phase === "intro") {
    events.push({ type: "game_start" });
  }
  const before = progressOf(prev, registry);
  const after = progressOf(next, registry);
  if (after && after.step === "reveal" && !(before?.key === after.key && before.step === "reveal")) {
    events.push({ type: "reveal", key: after.key, roundIndex: after.roundIndex, index: after.index, total: after.total });
  }
  if (after && after.step === "leaderboard" && !(before?.key === after.key && before.step === "leaderboard")) {
    events.push({ type: "leaderboard", key: after.key });
  }
  if (prev && prev.phase !== "finale" && next.phase === "finale") events.push({ type: "finale" });
  return events;
}

const WELCOME_ON_HOST_MS = 30_000;

export class VoiceDirector {
  /** Player ids waiting for their welcome. */
  private pendingWelcomes: string[] = [];
  private welcomesInFlight = 0;
  /** Welcome lines sent to the host screen and not reported as ended yet (id → sent at). */
  private welcomesOnHost = new Map<string, number>();
  /** A commentary line that is ready and waits for the leaderboard to start. */
  private readyComment: { key: string; produced: ProducedLine } | null = null;
  /** The commentary line currently shown with the leaderboard (for the hold extension). */
  private hold: { lineId: string; key: string; baseEnd: number } | null = null;

  constructor(private readonly rt: VoiceRuntime) {}

  private get registry() {
    return this.rt.registry ?? GAME_MODULES;
  }

  private enabled(room: RoomRecord | null = this.rt.read()): room is RoomRecord {
    return !!room && room.voice.settings.enabled && this.rt.hostConnected();
  }

  private run(task: () => Promise<void>) {
    this.rt.waitUntil(
      task().catch(() => {
        console.warn("voice: task failed");
      }),
    );
  }

  /** Reserves one generated line from the room budget; false → template only. */
  private async reserveLine(): Promise<boolean> {
    const room = this.rt.read();
    if (!room || room.voice.linesUsed >= VOICE_CONFIG.maxLinesPerRoom) return false;
    await this.updateVoice((v) => ({ ...v, linesUsed: v.linesUsed + 1 }));
    return true;
  }

  private async updateVoice(fn: (voice: RoomVoice) => RoomVoice) {
    const room = this.rt.read();
    if (room) await this.rt.commit({ ...room, voice: fn(room.voice) });
  }

  private log(kind: string, produced: ProducedLine) {
    const used = this.rt.read()?.voice.linesUsed ?? 0;
    console.log(`voice ${kind}: ${produced.source} (${used}/${VOICE_CONFIG.maxLinesPerRoom} lines)`);
  }

  private async produce(
    kind: HostLine["kind"],
    prompt: Parameters<typeof produceLine>[1]["prompt"],
    fallback: string,
    deadline: number | null = null,
  ): Promise<ProducedLine | null> {
    const room = this.rt.read();
    if (!room) return null;
    const useAi = await this.reserveLine();
    const produced = await produceLine(this.rt.services(), {
      code: room.code,
      id: this.rt.newId(),
      kind,
      prompt,
      fallback,
      useAi,
      deadline,
      now: this.rt.now,
      staleAfterMs: kind === "comment" ? 2_500 : null,
    });
    this.log(kind, produced);
    return produced;
  }

  private variant() {
    return Math.floor(this.rt.random() * 1_000_000);
  }

  // ── Part A: welcome ──────────────────────────────────────────────────
  playerJoined(playerId: string) {
    if (!this.enabled()) return;
    this.pendingWelcomes.push(playerId);
    this.pumpWelcomes();
  }

  private pumpWelcomes() {
    const now = this.rt.now();
    for (const [id, at] of this.welcomesOnHost) if (now - at > WELCOME_ON_HOST_MS) this.welcomesOnHost.delete(id);
    const capacity = VOICE_CONFIG.maxQueuedWelcomes - this.welcomesOnHost.size - this.welcomesInFlight;
    const { batches, rest } = planWelcomes(this.pendingWelcomes, capacity);
    this.pendingWelcomes = rest;
    for (const ids of batches) {
      this.welcomesInFlight++;
      this.run(async () => {
        try {
          await this.welcome(ids);
        } finally {
          this.welcomesInFlight--;
          this.pumpWelcomes();
        }
      });
    }
  }

  private async welcome(ids: readonly string[]) {
    const room = this.rt.read();
    const names = ids.flatMap((id) => room?.players.find((p) => p.id === id)?.name ?? []);
    if (!this.enabled(room) || names.length === 0) return;
    const produced = await this.produce(
      "welcome",
      welcomePrompt(names, this.variant()),
      welcomeTemplate(names.map(sanitizeName), this.rt.random),
    );
    if (produced && this.enabled() && this.rt.sendToHosts(produced.line)) {
      this.welcomesOnHost.set(produced.line.id, this.rt.now());
    }
  }

  // ── Room changes ─────────────────────────────────────────────────────
  roomChanged(prev: RoomRecord | null, next: RoomRecord) {
    for (const event of detectVoiceEvents(prev, next, this.registry)) {
      switch (event.type) {
        case "game_start":
          this.readyComment = null;
          this.hold = null;
          this.run(() => this.gameStart());
          break;
        case "reveal":
          this.run(() => this.reveal(event));
          break;
        case "leaderboard":
          this.leaderboard(event.key, next);
          break;
        case "finale":
          this.run(() => this.finale());
          break;
      }
    }
  }

  private async gameStart() {
    await this.updateVoice((v) => ({ ...v, streaks: {}, lastTargets: [], lastComment: null }));
    const room = this.rt.read();
    if (!this.enabled(room)) return;
    const categories = (room.game?.rounds ?? []).flatMap((r) => getModule(r.categoryId, this.registry)?.meta.name ?? []);
    const count = room.players.length;
    const produced = await this.produce("start", startPrompt(count, categories, this.variant()), startTemplate(count));
    if (produced && this.enabled()) this.rt.sendToHosts(produced.line);
  }

  // ── Part B: commentary ───────────────────────────────────────────────
  private async reveal(event: Extract<VoiceEvent, { type: "reveal" }>) {
    const room = this.rt.read();
    const game = room?.game;
    const round = game?.rounds[game.roundIndex];
    const module = round ? getModule(round.categoryId, this.registry) : undefined;
    const facts = game?.moduleState != null ? module?.revealFacts?.(game.moduleState) : null;
    if (!room || !game || !module || !facts) return;

    const streaks = updateStreaks(room.voice.streaks, room.players.map((p) => p.id), facts);
    const last = room.voice.lastComment;
    const lastIndex = last?.roundIndex === event.roundIndex ? last.index : null;
    const comment =
      this.enabled(room) && shouldComment(room.voice.settings.frequency, event.index, event.total, lastIndex);
    await this.updateVoice((v) => ({
      ...v,
      streaks,
      lastComment: comment ? { roundIndex: event.roundIndex, index: event.index } : v.lastComment,
    }));
    if (!comment) return;

    const leaderboard = game.questionLeaderboard ?? buildLeaderboard(room.players, game.scores, {});
    const players = commentPlayers(room.players, facts, leaderboard, streaks);
    const commentFacts: CommentFacts = {
      category: module.meta.name,
      question: facts.question,
      correctAnswer: facts.correctAnswer,
      lastQuestionOfCategory: event.index === event.total - 1,
      players,
      highlights: commentHighlights(players),
    };
    const cheekiness = effectiveCheekiness(room.voice.settings, game.rounds.flatMap((r) => getModule(r.categoryId, this.registry)?.meta ?? []));
    const lastTarget = room.players.find((p) => p.id === room.voice.lastTargets[0]);
    const leader = players.find((p) => p.rankAfter === 1)?.name ?? null;
    const produced = await this.produce(
      "comment",
      commentPrompt(commentFacts, cheekiness, lastTarget ? [lastTarget.name] : [], this.variant()),
      commentTemplate(leader ? sanitizeName(leader) : null, this.rt.random),
      // Must be ready when the leaderboard starts – otherwise it is skipped.
      room.phaseEndsAt,
    );
    const now = progressOf(this.rt.read(), this.registry);
    if (produced && now?.key === event.key && now.step === "reveal") {
      this.readyComment = { key: event.key, produced };
    }
  }

  private leaderboard(key: string, room: RoomRecord) {
    const ready = this.readyComment;
    this.readyComment = null;
    if (!ready || ready.key !== key || !this.enabled(room)) return;
    if (!this.rt.sendToHosts(ready.produced.line)) return;
    this.hold = { lineId: ready.produced.line.id, key, baseEnd: room.phaseEndsAt ?? this.rt.now() };
    const target = ready.produced.target;
    const targetId = target
      ? (room.players.find((p) => sanitizeName(p.name).toLowerCase() === sanitizeName(target).toLowerCase())?.id ?? null)
      : null;
    this.run(() => this.updateVoice((v) => ({ ...v, lastTargets: rememberTarget(v.lastTargets, targetId) })));
  }

  private async finale() {
    const room = this.rt.read();
    const game = room?.game;
    if (!this.enabled(room) || !game) return;
    const standings = buildLeaderboard(room.players, game.scores, {})
      .map((e) => ({ name: room.players.find((p) => p.id === e.playerId)?.name ?? "", score: e.scoreAfter, rank: e.rankAfter }))
      .filter((s) => s.name);
    const winners = standings.filter((s) => s.rank === 1).map((s) => sanitizeName(s.name));
    const cheekiness = effectiveCheekiness(room.voice.settings, game.rounds.flatMap((r) => getModule(r.categoryId, this.registry)?.meta ?? []));
    const produced = await this.produce("finale", finalePrompt(standings, cheekiness, this.variant()), finaleTemplate(winners));
    if (produced && this.enabled()) this.rt.sendToHosts(produced.line);
  }

  // ── Host screen feedback ─────────────────────────────────────────────
  hostEvent(lineId: string, event: "started" | "ended", endsAt?: number) {
    if (event === "ended") {
      if (this.welcomesOnHost.delete(lineId)) this.pumpWelcomes();
      if (this.hold?.lineId === lineId) this.hold = null;
      return;
    }
    const hold = this.hold;
    if (!hold || hold.lineId !== lineId || endsAt === undefined) return;
    const room = this.rt.read();
    const progress = progressOf(room, this.registry);
    if (!room || room.phaseEndsAt === null || progress?.key !== hold.key || progress.step !== "leaderboard") return;
    const end = extendedPhaseEnd(room.phaseEndsAt, hold.baseEnd, endsAt);
    if (end > room.phaseEndsAt) this.run(() => this.rt.commit({ ...room, phaseEndsAt: end }));
  }
}
