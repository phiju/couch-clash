/**
 * The host's voice inside one room. The Durable Object tells the director
 * what happened (player joined, room changed, host screen played a line);
 * the director decides what the host says and produces it in the
 * background. Nothing here ever delays the game.
 */
import { TEMPO_PLAYBACK_RATE, TEMPO_SPEED, buildLeaderboard, type HostLine } from "@couch-clash/shared";
import { SNARK_LINES_DE } from "@couch-clash/content";
import { GAME_MODULES, getModule, type ModuleRegistry } from "@couch-clash/games";
import { progressOf } from "../progress";
import { finalLeaderboard } from "../game-flow";
import type { RoomRecord } from "../room-logic";

export { progressOf };
import { VOICE_CONFIG } from "./config";
import {
  commentPrompt,
  finalePrompt,
  sanitizeName,
  startPrompt,
  summaryFactsWithNames,
  summaryPrompt,
  testPrompt,
  welcomePrompt,
  type CommentFacts,
} from "./prompt";
import type { LinePrompt, SpeechStyle } from "./provider";
import {
  accountLow,
  commentHighlights,
  commentPlayers,
  effectiveCheekiness,
  extendedPhaseEnd,
  planWelcomes,
  rememberTarget,
  reserveCredits,
  shouldComment,
  updateStreaks,
  type RoomVoice,
} from "./rules";
import { cachedClip, produceLine, type ProducedLine, type VoiceServices } from "./service";
import { SurvivalVoice, type SurvivalVoiceRuntime } from "./survival-voice";
import { MusikVoice } from "./musik-voice";
import { PixelpanikVoice } from "./pixelpanik-voice";
import type { MusikState, PixelpanikState, SurvivalCue, SurvivalState } from "@couch-clash/games";
import { chooseSnark, detectSituations, isNoteworthy, updateWrongStreaks, type SituationHit } from "./snark";
import { commentTemplate, finaleTemplate, startTemplate, summaryTemplate, welcomeTemplate } from "./templates";

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
  /** Survival-Finale: the moderator's line the finale waits for is over (start the ride / the ceremony). */
  survivalCue?(cue: SurvivalCue): void;
}

export type VoiceEvent =
  | { type: "game_start" }
  | { type: "intro"; roundIndex: number }
  | { type: "reveal"; key: string; roundIndex: number; index: number; total: number }
  | { type: "leaderboard"; key: string }
  | { type: "summary"; key: string }
  | { type: "finale" };

/** What happened between two room states (for the voice). */
export function detectVoiceEvents(
  prev: RoomRecord | null,
  next: RoomRecord,
  registry: ModuleRegistry = GAME_MODULES,
): VoiceEvent[] {
  const events: VoiceEvent[] = [];
  if (prev && prev.phase === "lobby" && next.phase === "intro") {
    events.push({ type: "game_start" });
  }
  if (next.phase === "intro" && next.game && (prev?.phase !== "intro" || prev.game?.roundIndex !== next.game.roundIndex)) {
    events.push({ type: "intro", roundIndex: next.game.roundIndex });
  }
  const before = progressOf(prev, registry);
  const after = progressOf(next, registry);
  if (after && after.step === "reveal" && !(before?.key === after.key && before.step === "reveal")) {
    events.push({ type: "reveal", key: after.key, roundIndex: after.roundIndex, index: after.index, total: after.total });
  }
  if (after && after.step === "leaderboard" && !(before?.key === after.key && before.step === "leaderboard")) {
    events.push({ type: "leaderboard", key: after.key });
  }
  if (after && after.step === "summary" && !(before?.key === after.key && before.step === "summary")) {
    events.push({ type: "summary", key: after.key });
  }
  if (prev && prev.phase !== "finale" && next.phase === "finale") events.push({ type: "finale" });
  return events;
}

const WELCOME_ON_HOST_MS = 30_000;

/** A cached library line ready to play (name clip + line). */
interface CachedComment {
  line: HostLine;
  /** The library text (never twice in a game). */
  text: string;
  targetId: string | null;
}

/** The comment for one question: a live line and/or a cached one, whichever is ready at the leaderboard. */
interface CommentJob {
  key: string;
  live: ProducedLine | null;
  cached: CachedComment | null;
  sent: boolean;
  livePromise?: Promise<void>;
  cachedPromise?: Promise<void>;
}

export class VoiceDirector {
  /** Player ids waiting for their welcome. */
  private pendingWelcomes: string[] = [];
  private welcomesInFlight = 0;
  /** Welcome lines sent to the host screen and not reported as ended yet (id → sent at). */
  private welcomesOnHost = new Map<string, number>();
  /** The comment being prepared for the current question (live and/or cached). */
  private comments: CommentJob | null = null;
  /** The line currently shown with the leaderboard / round summary (for the hold extension). */
  private hold: { lineId: string; key: string; step: string; baseEnd: number } | null = null;
  /** What the host is reading out (e.g. the Bluff-Lexikon options). */
  private reading: { key: string; lineIds: Set<string>; baseEnd: number } | null = null;

  /** Survival-Finale: event-driven commentary with its own audio warm-up. */
  private readonly survival: SurvivalVoice;
  /** Pixelpanik: event-driven lines (wrong guess, early hit, nobody got it, …). */
  private readonly pixelpanik: PixelpanikVoice;
  /** Musik-Quiz: announces the question type, comments buzzes and years. */
  private readonly musik: MusikVoice;

  constructor(private readonly rt: VoiceRuntime) {
    const eventVoice: SurvivalVoiceRuntime = {
      enabled: () => this.enabled(),
      allowNew: () => {
        const room = this.rt.read();
        return !!room && this.newAudioAllowed(room);
      },
      clip: async (text, allowNew, reserve) => {
        const clip = await cachedClip(this.rt.services(), {
          kind: "snark",
          text,
          style: "fast",
          speed: VOICE_CONFIG.cachedSpeed,
          allowNew,
          reserveCredits: reserve,
        });
        if (clip.voiceStatus === "unavailable") await this.stopNewAudio("unavailable", clip.errorCode);
        return { path: clip.path, cached: clip.cached, refused: clip.voiceStatus === "unavailable" };
      },
      reserveCredits: (credits) => this.reserveCredits(credits),
      send: (line) => this.rt.sendToHosts(line),
      playbackRate: () => TEMPO_PLAYBACK_RATE[this.rt.read()?.voice.settings.tempo ?? "schnell"],
      now: () => this.rt.now(),
      random: () => this.rt.random(),
      newId: () => this.rt.newId(),
      run: (task) => this.run(task),
      log: (message) => console.log(message),
      cue: (cue) => this.rt.survivalCue?.(cue),
    };
    this.survival = new SurvivalVoice(eventVoice);
    this.pixelpanik = new PixelpanikVoice(eventVoice);
    this.musik = new MusikVoice(eventVoice);
  }

  private get registry() {
    return this.rt.registry ?? GAME_MODULES;
  }

  /** Speaking makes sense: switched on, a host screen listening, a voice available. */
  private enabled(room: RoomRecord | null = this.rt.read()): room is RoomRecord {
    return !!room && room.voice.settings.enabled && this.canSpeak();
  }

  /** Cached audio needs only a host screen and the store – even when no NEW audio can be made. */
  private canSpeak(): boolean {
    return this.rt.hostConnected() && this.rt.services().store !== null;
  }

  /** Whether the text model may add audio tags for this style. */
  private tags(style: SpeechStyle): boolean {
    return this.rt.services().speech?.supportsTags(style) ?? false;
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
    const credits = this.rt.read()?.voice.creditsUsed ?? 0;
    console.log(
      `voice ${kind}: ${produced.cached ? "cached" : produced.source}${produced.line ? "" : " (silent)"} (${used}/${VOICE_CONFIG.maxLinesPerRoom} lines, ${credits}/${VOICE_CONFIG.creditBudgetPerRoom} credits)`,
    );
  }

  private async produce(
    kind: HostLine["kind"],
    style: SpeechStyle,
    prompt: LinePrompt,
    fallback: string,
    deadline: number | null = null,
    /** False: fixed text (e.g. reading out) – no text model, no line from the budget, cached globally. */
    ai = true,
  ): Promise<ProducedLine | null> {
    const room = this.rt.read();
    if (!room) return null;
    const allowNew = this.newAudioAllowed(room);
    const useAi = ai && allowNew ? await this.reserveLine() : false;
    const tempo = room.voice.settings.tempo;
    const produced = await produceLine(this.rt.services(), {
      code: room.code,
      id: this.rt.newId(),
      kind,
      prompt,
      fallback,
      useAi,
      allowNew,
      ...(ai ? {} : { cacheKind: "read" as const }),
      style,
      speed: TEMPO_SPEED[tempo],
      playbackRate: TEMPO_PLAYBACK_RATE[tempo],
      deadline,
      now: this.rt.now,
      reserveCredits: (credits) => this.reserveCredits(credits),
      staleAfterMs: kind === "comment" ? 2_500 : null,
    });
    this.log(kind, produced);
    if (produced.voiceStatus) await this.stopNewAudio(produced.voiceStatus, produced.errorCode);
    return produced;
  }

  /** Sends a produced line if it has audio and the voice is still wanted. */
  private deliver(produced: ProducedLine | null): HostLine | null {
    const line = produced?.line;
    if (!line || !this.enabled()) return null;
    return this.rt.sendToHosts(line) ? line : null;
  }

  private variant() {
    return Math.floor(this.rt.random() * 1_000_000);
  }

  // ── Part A: welcome ──────────────────────────────────────────────────
  playerJoined(playerId: string) {
    if (!this.enabled()) return;
    this.pendingWelcomes.push(playerId);
    this.pumpWelcomes();
    // The name clip for library lines ("Max …") – once per player, reused for the same name.
    this.run(async () => {
      await this.refreshAccount();
      await this.nameClip(playerId);
    });
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
      "expressive",
      welcomePrompt(names, this.variant(), this.tags("expressive")),
      welcomeTemplate(names.map(sanitizeName), this.rt.random),
    );
    const sent = this.deliver(produced);
    if (sent) this.welcomesOnHost.set(sent.id, this.rt.now());
  }

  // ── Room changes ─────────────────────────────────────────────────────
  roomChanged(prev: RoomRecord | null, next: RoomRecord) {
    this.readAloudChanged(next);
    const survival = this.survivalState(next);
    if (survival) {
      const names = Object.fromEntries(next.players.map((p) => [p.id, sanitizeName(p.name)]));
      this.survival.roomChanged(survival, names);
    }
    const pixelpanik = this.pixelpanikState(next);
    if (pixelpanik) {
      const names = Object.fromEntries(next.players.map((p) => [p.id, sanitizeName(p.name)]));
      this.pixelpanik.roomChanged(pixelpanik, names, next.mode.mode);
    }
    const musik = this.musikState(next);
    if (musik) {
      const names = Object.fromEntries(next.players.map((p) => [p.id, sanitizeName(p.name)]));
      this.musik.roomChanged(musik, names, next.mode.mode);
    }
    const events = detectVoiceEvents(prev, next, this.registry);
    const starting = events.some((e) => e.type === "game_start");
    for (const event of events) {
      switch (event.type) {
        case "game_start":
          this.comments = null;
          this.hold = null;
          // The first game's explanation follows the opening line.
          this.run(async () => {
            await this.gameStart();
            await this.introduce(0);
          });
          break;
        case "intro":
          if (!starting) this.run(() => this.introduce(event.roundIndex));
          break;
        case "reveal":
          this.run(() => this.reveal(event));
          break;
        case "leaderboard":
          this.leaderboard(event.key);
          break;
        case "summary":
          this.run(() => this.summary(event.key));
          break;
        case "finale":
          this.run(() => this.finale());
          break;
      }
    }
  }

  private async gameStart() {
    await this.updateVoice((v) => ({ ...v, streaks: {}, wrongStreaks: {}, usedSnark: [], lastTargets: [], lastComment: null }));
    await this.refreshAccount();
    const room = this.rt.read();
    if (!this.enabled(room)) return;
    const categories = (room.game?.rounds ?? []).flatMap((r) => getModule(r.categoryId, this.registry)?.meta.name ?? []);
    const count = room.players.length;
    const produced = await this.produce(
      "start",
      "expressive",
      startPrompt(count, categories, this.variant(), this.tags("expressive")),
      startTemplate(count),
    );
    this.deliver(produced);
  }

  /** Intro card of a game that explains itself (CategoryMeta.announceIntro): the host reads the explanation. */
  private async introduce(roundIndex: number) {
    const room = this.rt.read();
    const round = room?.game?.rounds[roundIndex];
    const meta = round ? getModule(round.categoryId, this.registry)?.meta : undefined;
    if (!this.enabled(room) || !meta?.announceIntro) return;
    const produced = await this.produce("read", "fast", { system: "", user: "" }, `${meta.name}! ${meta.description}`, null, false);
    const now = this.rt.read();
    // Only while this game is still being introduced (or has just started).
    if (now?.game?.roundIndex === roundIndex && (now.phase === "intro" || now.phase === "play")) this.deliver(produced);
  }

  /** The Survival-Finale's state while it plays (its commentary is event-driven). */
  private survivalState(room: RoomRecord): SurvivalState | null {
    const game = room.phase === "play" ? room.game : null;
    const round = game?.rounds[game.roundIndex];
    if (!game || game.moduleState == null || !round) return null;
    return getModule(round.categoryId, this.registry)?.meta.finale ? (game.moduleState as SurvivalState) : null;
  }

  /** Pixelpanik's state while it plays (its commentary is event-driven, too). */
  private pixelpanikState(room: RoomRecord): PixelpanikState | null {
    const game = room.phase === "play" ? room.game : null;
    const round = game?.rounds[game.roundIndex];
    if (!game || game.moduleState == null || round?.categoryId !== "pixelpanik") return null;
    return game.moduleState as PixelpanikState;
  }

  /** The Musik-Quiz's state while it plays (event-driven, like Pixelpanik). */
  private musikState(room: RoomRecord): MusikState | null {
    const game = room.phase === "play" ? room.game : null;
    const round = game?.rounds[game.roundIndex];
    if (!game || game.moduleState == null || round?.categoryId !== "musik") return null;
    return game.moduleState as MusikState;
  }

  // ── Part B: commentary ───────────────────────────────────────────────
  /**
   * The answers are locked the moment a question reveals – right then the
   * live line (text model + voice) and a cached library line are prepared in
   * parallel. The leaderboard plays the live line if it is ready, otherwise
   * the cached one: the host never skips a comment.
   */
  private async reveal(event: Extract<VoiceEvent, { type: "reveal" }>) {
    const room = this.rt.read();
    const game = room?.game;
    const round = game?.rounds[game.roundIndex];
    const module = round ? getModule(round.categoryId, this.registry) : undefined;
    const facts = game?.moduleState != null ? module?.revealFacts?.(game.moduleState) : null;
    if (!room || !game || !module || !facts) return;

    const playerIds = room.players.map((p) => p.id);
    const leaderboard = game.questionLeaderboard ?? buildLeaderboard(room.players, game.scores, {});
    const hits = detectSituations({ playerIds, facts, leaderboard, wrongStreaksBefore: room.voice.wrongStreaks });
    const streaks = updateStreaks(room.voice.streaks, playerIds, facts);
    const wrongStreaks = updateWrongStreaks(room.voice.wrongStreaks, playerIds, facts);
    const last = room.voice.lastComment;
    const lastIndex = last?.roundIndex === event.roundIndex ? last.index : null;
    const comment =
      this.enabled(room) &&
      shouldComment(room.voice.settings.frequency, event.index, event.total, lastIndex, isNoteworthy(hits));

    const job: CommentJob = { key: event.key, live: null, cached: null, sent: false };
    if (comment) {
      this.comments = job;
      // Both start before any state is written – every millisecond counts until the leaderboard.
      const wantLive = this.rt.random() < VOICE_CONFIG.liveCommentShare && this.liveAllowed(room);
      if (wantLive) {
        const players = commentPlayers(room.players, facts, leaderboard, streaks);
        const commentFacts: CommentFacts = {
          category: module.meta.name,
          ...(module.meta.hostPersona ? { persona: module.meta.hostPersona } : {}),
          question: facts.question,
          correctAnswer: facts.correctAnswer,
          lastQuestionOfCategory: event.index === event.total - 1,
          players,
          highlights: [...(facts.highlights ?? []), ...commentHighlights(players)],
          // Only in Party mode – a party item can never reach Kids / Familie anyway.
          ...(facts.partyItem && room.mode.mode === "party" ? { partyItem: true } : {}),
        };
        const cheekiness = effectiveCheekiness(room.voice.settings, room.mode.mode);
        const lastTarget = room.players.find((p) => p.id === room.voice.lastTargets[0]);
        const leader = players.find((p) => p.rankAfter === 1)?.name ?? null;
        job.livePromise = this.produce(
          "comment",
          "fast",
          commentPrompt(commentFacts, cheekiness, lastTarget ? [lastTarget.name] : [], this.variant(), room.mode.mode),
          commentTemplate(leader ? sanitizeName(leader) : null, this.rt.random),
          room.phaseEndsAt,
        ).then((produced) => {
          job.live = produced;
          this.tryDeliverComment(job);
        });
      }
      job.cachedPromise = this.cachedComment(room, hits).then((cached) => {
        job.cached = cached;
        this.tryDeliverComment(job);
      });
    }

    await this.updateVoice((v) => ({
      ...v,
      streaks,
      wrongStreaks,
      lastComment: comment ? { roundIndex: event.roundIndex, index: event.index } : v.lastComment,
    }));
    // Keeps the monthly guard current during long games (the fetcher caches ~10 min).
    this.run(() => this.refreshAccount());
    await Promise.all([job.livePromise, job.cachedPromise]);
  }

  /** Live lines need the text model, budget, credits and a line from the room's line budget. */
  private liveAllowed(room: RoomRecord): boolean {
    return (
      this.rt.services().text !== null &&
      this.newAudioAllowed(room) &&
      room.voice.linesUsed < VOICE_CONFIG.maxLinesPerRoom
    );
  }

  /** NEW audio may be generated (costs credits): service ok, room budget left, account not nearly used up. */
  private newAudioAllowed(room: RoomRecord): boolean {
    return room.voice.status === "ok" && this.rt.services().speech !== null && !accountLow(room.voice.account);
  }

  /** A library line for the situation, with the target's name clip in front. */
  private async cachedComment(room: RoomRecord, hits: readonly SituationHit[]): Promise<CachedComment | null> {
    const pick = chooseSnark(
      hits,
      room.voice.lastTargets[0] ?? null,
      room.players.length,
      SNARK_LINES_DE,
      room.mode.mode,
      room.voice.usedSnark,
      this.rt.random,
    );
    if (!pick) return null;
    const { text } = pick;
    const allowNew = this.newAudioAllowed(room);
    const [clip, name] = await Promise.all([
      this.cachedClip("snark", text, allowNew),
      pick.targetId ? this.nameClip(pick.targetId) : Promise.resolve(null),
    ]);
    if (!clip) return null;
    const player = pick.targetId ? room.players.find((p) => p.id === pick.targetId) : undefined;
    const line: HostLine = {
      id: this.rt.newId(),
      kind: "comment",
      text: player && name ? `${sanitizeName(player.name)} … ${text}` : text,
      audioPath: clip,
      playbackRate: TEMPO_PLAYBACK_RATE[room.voice.settings.tempo],
      staleAfterMs: 2_500,
      ...(name ? { prefixAudioPath: name, prefixGapMs: VOICE_CONFIG.nameGapMs } : {}),
    };
    return { line, text, targetId: pick.targetId };
  }

  /** Sends the comment once the leaderboard shows: the live line if ready, else the cached one. */
  private tryDeliverComment(job: CommentJob) {
    if (job.sent || this.comments !== job) return;
    const room = this.rt.read();
    const progress = progressOf(room, this.registry);
    if (!room || progress?.key !== job.key || progress.step !== "leaderboard" || !this.enabled(room)) return;
    const live = job.live?.line ?? null;
    // Live still being written but the cached one is ready → no waiting.
    const choice = live ? "live" : job.cached ? "cached" : null;
    if (!choice) return;
    const line = choice === "live" ? live! : job.cached!.line;
    if (!this.rt.sendToHosts(line)) return;
    job.sent = true;
    this.comments = null;
    this.hold = { lineId: line.id, key: job.key, step: "leaderboard", baseEnd: room.phaseEndsAt ?? this.rt.now() };
    if (choice === "live") {
      const target = job.live!.target;
      const targetId = target
        ? (room.players.find((p) => sanitizeName(p.name).toLowerCase() === sanitizeName(target).toLowerCase())?.id ?? null)
        : null;
      this.run(() => this.updateVoice((v) => ({ ...v, lastTargets: rememberTarget(v.lastTargets, targetId) })));
    } else {
      const { text, targetId } = job.cached!;
      this.run(() =>
        this.updateVoice((v) => ({
          ...v,
          lastTargets: rememberTarget(v.lastTargets, targetId),
          usedSnark: [...v.usedSnark, text],
        })),
      );
    }
  }

  private leaderboard(key: string) {
    const job = this.comments;
    if (job?.key === key) this.tryDeliverComment(job);
  }

  // ── Cached audio (library lines, name clips) ─────────────────────────
  private async cachedClip(kind: "snark" | "names", text: string, allowNew: boolean): Promise<string | null> {
    const clip = await cachedClip(this.rt.services(), {
      kind,
      text,
      style: "fast",
      speed: VOICE_CONFIG.cachedSpeed,
      allowNew,
      reserveCredits: (credits) => this.reserveCredits(credits),
    });
    if (clip.voiceStatus) await this.stopNewAudio(clip.voiceStatus, clip.errorCode);
    return clip.path;
  }

  /** "Max …" – made once per player (reused globally for the same name), played in front of library lines. */
  private async nameClip(playerId: string): Promise<string | null> {
    const room = this.rt.read();
    const known = room?.voice.nameClips[playerId];
    if (!room || known) return known ?? null;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return null;
    const path = await this.cachedClip("names", `${sanitizeName(player.name)} …`, this.newAudioAllowed(room));
    if (path) await this.updateVoice((v) => ({ ...v, nameClips: { ...v.nameClips, [playerId]: path } }));
    return path;
  }

  private async reserveCredits(credits: number): Promise<boolean> {
    const current = this.rt.read();
    const next = current ? reserveCredits(current.voice, credits) : null;
    if (!current || !next) return false;
    await this.rt.commit({ ...current, voice: next });
    return true;
  }

  /** No more NEW audio in this room (refused / budget) – cached lines keep playing. */
  private async stopNewAudio(status: "unavailable" | "budget", errorCode?: string) {
    const room = this.rt.read();
    // The first reason stays (a refused key is not "budget used up").
    if (!room || room.voice.status !== "ok") return;
    console.warn(`voice: no new audio in this room (${status}${errorCode ? ` ${errorCode}` : ""}) – cached lines only`);
    await this.updateVoice((v) => ({ ...v, status, errorCode: errorCode ?? null }));
  }

  /** ElevenLabs usage this month (cached ~10 min by the fetcher); stored for the host panel and the guard. */
  private async refreshAccount() {
    const usage = await this.rt.services().usage?.();
    const room = this.rt.read();
    if (!usage || !room) return;
    const known = room.voice.account;
    if (known?.used === usage.used && known.limit === usage.limit) return;
    await this.updateVoice((v) => ({ ...v, account: usage }));
  }

  /** Round summary (e.g. BESTANDEN / DURCHGEFALLEN): one line right away; the step waits for it (bounded). */
  private async summary(key: string) {
    const room = this.rt.read();
    const game = room?.game;
    const round = game?.rounds[game.roundIndex];
    const module = round ? getModule(round.categoryId, this.registry) : undefined;
    const facts = game?.moduleState != null ? module?.summaryFacts?.(game.moduleState) : null;
    if (!this.enabled(room) || !module || !facts) return;
    const named = summaryFactsWithNames(module.meta.name, facts, room.players);
    const cheekiness = effectiveCheekiness(room.voice.settings, room.mode.mode);
    const produced = await this.produce(
      "comment",
      "fast",
      summaryPrompt(named, cheekiness, module.meta.hostPersona, this.variant(), this.tags("fast"), room.mode.mode),
      summaryTemplate(named.players),
      room.phaseEndsAt,
    );
    const now = this.rt.read();
    const progress = progressOf(now, this.registry);
    if (!now || progress?.key !== key || progress.step !== "summary") return;
    const sent = this.deliver(produced);
    if (sent) this.hold = { lineId: sent.id, key, step: "summary", baseEnd: now.phaseEndsAt ?? this.rt.now() };
  }

  private async finale() {
    const room = this.rt.read();
    const game = room?.game;
    if (!this.enabled(room) || !game) return;
    const standings = finalLeaderboard(room)
      .map((e) => ({ name: room.players.find((p) => p.id === e.playerId)?.name ?? "", score: e.scoreAfter, rank: e.rankAfter }))
      .filter((s) => s.name);
    const winners = standings.filter((s) => s.rank === 1).map((s) => sanitizeName(s.name));
    const cheekiness = effectiveCheekiness(room.voice.settings, room.mode.mode);
    const produced = await this.produce(
      "finale",
      "expressive",
      finalePrompt(standings, cheekiness, this.variant(), this.tags("expressive"), room.mode.mode),
      finaleTemplate(winners),
    );
    this.deliver(produced);
  }

  /** The voice reads slower than the fallback timing → the step waits for it (bounded). */
  private extendReading(reading: { key: string; baseEnd: number }, endsAt: number) {
    const room = this.rt.read();
    if (!room || room.phaseEndsAt === null || this.currentReadAloud(room)?.key !== reading.key) return;
    const end = Math.min(endsAt + VOICE_CONFIG.readPauseMs, reading.baseEnd + VOICE_CONFIG.maxReadExtensionMs);
    if (end > room.phaseEndsAt) this.run(() => this.rt.commit({ ...room, phaseEndsAt: end }));
  }

  /** "Stimme erneut versuchen": lifts the room's voice stop after a refusal (e.g. new key or plan). */
  async retryVoice() {
    const room = this.rt.read();
    if (!room || room.voice.status !== "unavailable") return;
    await this.updateVoice((v) => ({ ...v, status: "ok", errorCode: null }));
  }

  // ── "Moderator testen" ───────────────────────────────────────────────
  private testing = false;

  /** "▶ Probe-Spruch" / "▶ Nochmal": a sample line in the chosen tone (counts towards the budget). */
  testLine() {
    const room = this.rt.read();
    if (!room || this.testing || !this.canSpeak()) return;
    this.testing = true;
    this.run(async () => {
      try {
        const current = this.rt.read();
        if (!current) return;
        const cheekiness = effectiveCheekiness(current.voice.settings, current.mode.mode);
        // Sounds like the comments in the game (eleven_flash).
        const produced = await this.produce(
          "test",
          "fast",
          testPrompt(cheekiness, this.variant(), this.tags("fast"), current.mode.mode),
          "Meine Damen und Herren – hier spricht Ihr Moderator!",
        );
        const line = produced?.line;
        const now = this.rt.read();
        if (line && now && this.canSpeak()) this.rt.sendToHosts(line);
      } finally {
        this.testing = false;
      }
    });
  }

  // ── Reading out (GameModule.readAloud) ───────────────────────────────
  private currentReadAloud(room: RoomRecord | null) {
    const game = room?.phase === "play" ? room.game : null;
    const round = game?.rounds[game.roundIndex];
    const module = round ? getModule(round.categoryId, this.registry) : undefined;
    return game?.moduleState != null ? (module?.readAloud?.(game.moduleState) ?? null) : null;
  }

  private readAloudChanged(room: RoomRecord) {
    const read = this.currentReadAloud(room);
    if (!read) {
      this.reading = null;
      return;
    }
    if (this.reading?.key === read.key) return;
    const reading = { key: read.key, lineIds: new Set<string>(), baseEnd: room.phaseEndsAt ?? this.rt.now() };
    this.reading = reading;
    if (!this.enabled(room)) return;
    // All clips in parallel, sent in order (the host plays them one after another).
    const clips = read.items.map((item) =>
      this.produce("read", "fast", { system: "", user: "" }, item.text, null, false).then((produced) => ({ produced, cue: item.cue })),
    );
    this.run(async () => {
      for (const clip of clips) {
        const { produced, cue } = await clip;
        if (this.reading !== reading) return;
        const line = produced?.line;
        if (!line || !this.enabled()) continue;
        const withCue = { ...line, cue };
        if (this.rt.sendToHosts(withCue)) reading.lineIds.add(withCue.id);
      }
    });
  }

  // ── Host screen feedback ─────────────────────────────────────────────
  hostEvent(lineId: string, event: "started" | "ended", endsAt?: number) {
    if (event === "started" && endsAt !== undefined && this.reading?.lineIds.has(lineId)) {
      this.extendReading(this.reading, endsAt);
      return;
    }
    if (event === "ended") {
      this.survival.lineEnded(lineId);
      if (this.welcomesOnHost.delete(lineId)) this.pumpWelcomes();
      if (this.hold?.lineId === lineId) this.hold = null;
      return;
    }
    const hold = this.hold;
    if (!hold || hold.lineId !== lineId || endsAt === undefined) return;
    const room = this.rt.read();
    const progress = progressOf(room, this.registry);
    if (!room || room.phaseEndsAt === null || progress?.key !== hold.key || progress.step !== hold.step) return;
    const end = extendedPhaseEnd(room.phaseEndsAt, hold.baseEnd, endsAt);
    if (end > room.phaseEndsAt) this.run(() => this.rt.commit({ ...room, phaseEndsAt: end }));
  }
}
