/**
 * Pixelpanik – server-authoritative logic (pure, no I/O, no timers).
 *
 * Per picture: six stages (4×4 … 64×64 blocks, then full resolution), each
 * `stageSeconds` long, then the solution (5 s) and the leaderboard. Points
 * depend on the stage of the right answer; everyone right in the same stage
 * gets the same points. They are booked at the solution in one scoreDelta.
 *
 * - Familie / Party (free text): typo-tolerant check (match.ts). Wrong = out
 *   for this picture, right = locked with the points secured. The picture
 *   ends early once everyone is done.
 * - Kids (four options): a wrong option is greyed out for good and locks the
 *   player until the next stage – nobody is ever out.
 *
 * Anti-cheat: the TV only gets the URL of the CURRENT stage (pre-rendered by
 * the image script under random file names); the full picture comes with
 * stage 6. Phones never get a picture.
 */
import { PIXELPANIK_MOTIFS, PixelpanikMotifSchema, type PixelpanikImage, type PixelpanikMotif } from "@couch-clash/content";
import {
  REVEAL_LEADERBOARD_MS,
  botChoice,
  botPick,
  difficultyWeight,
  eligibleForMode,
  type ContentEntry,
  type ContentFlags,
  type GameModeSettings,
  type GameModule,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { parseWith } from "../content-pool";
import { selectWithPartyShare } from "../party-share";
import { normalizeScoring } from "../scoring/normalize";
import { shuffle, weightedShuffle } from "../random";
import { buildCatalog, isCorrectGuess, termsOf, type MatchCatalog } from "./match";
import { PIXELPANIK_CONFIG, PIXELPANIK_STAGES, pixelpanikMeta } from "./meta";
import type {
  PixelpanikAction,
  PixelpanikEvent,
  PixelpanikInput,
  PixelpanikPlayerStatus,
  PixelpanikPublicState,
  PixelpanikStep,
} from "./types";

const STAGE_COUNT = PIXELPANIK_STAGES.length;
const LAST_STAGE = STAGE_COUNT - 1;

/** A motif ready to play (options shuffled once, terms normalized once). */
export interface PreparedMotif {
  id: string;
  category: string;
  answer: string;
  /** Normalized answer + synonyms. */
  terms: string[];
  choices: string[] | null;
  correctChoice: number | null;
  stages: string[];
  source: PixelpanikImage["source"] | null;
  party: boolean;
}

export interface PixelpanikPlayerRun {
  status: Exclude<PixelpanikPlayerStatus, "locked">;
  /** 0-based stage of the right answer. */
  correctStage: number | null;
  /** Server time of the right answer (free text: also of the wrong one). */
  at: number | null;
  /** Free text: what was sent. Kids: the last option picked. */
  guess: string | null;
  /** Kids: wrong options (greyed out for the rest of the picture). */
  wrongChoices: number[];
  /** Kids: stage in which the last wrong option was picked (locked until the next stage). */
  lockedStage: number | null;
}

export interface PixelpanikState {
  motifs: PreparedMotif[];
  index: number;
  step: PixelpanikStep;
  input: PixelpanikInput;
  stage: number;
  imageStartedAt: number;
  stageStartedAt: number;
  stepEndsAt: number;
  stageMs: number;
  /** Points per stage (host settings). */
  points: number[];
  players: Record<string, PixelpanikPlayerRun>;
  /** Points per player id for the current picture (from the solution on). */
  results: Record<string, number> | null;
  /** For the host's voice (server only). */
  events: PixelpanikEvent[];
  eventSeq: number;
  /** Identifies this round (the voice keeps its memory per round). */
  roundKey: string;
}

export type PixelpanikModule = GameModule<PixelpanikState, PixelpanikAction, PixelpanikPublicState>;

const DIFFICULTY = { leicht: 1, mittel: 2, schwer: 3 } as const;
const MAX_EVENTS = 30;

/** Motifs only for the party (modes: ["party"]) are the party pool. */
export function isPartyMotif(m: Pick<PixelpanikMotif, "modes">): boolean {
  return !m.modes.includes("kinder") && !m.modes.includes("erwachsene");
}

/**
 * The flags the global mode filter works with: Kids ⇔ "kinder", Familie ⇔
 * "erwachsene" (Normal), Party ⇔ everything with "party".
 */
export function motifFlags(m: PixelpanikMotif): ContentFlags {
  const party = isPartyMotif(m);
  return {
    ageRating: m.modes.includes("kinder") ? 6 : party ? 18 : 12,
    difficulty: DIFFICULTY[m.difficulty],
    adult: party,
  };
}

/** May this motif come up in the mode? (the motif's own `modes` list) */
export function motifFitsMode(m: PixelpanikMotif, mode: GameModeSettings): boolean {
  if (mode.mode === "kids") return m.modes.includes("kinder") && m.kids_choices !== null;
  if (mode.mode === "family") return m.modes.includes("erwachsene");
  return m.modes.includes("party");
}

/** Motifs with pictures (the image script ran for them). */
export function playableMotifs(pool: readonly PixelpanikMotif[]): PixelpanikMotif[] {
  return pool.filter((m) => m.image && m.image.stages.length === STAGE_COUNT);
}

/**
 * Orders the round so that no two pictures in a row share a topic whenever
 * that is possible: next comes the topic with the most pictures left that
 * differs from the one before (ties: the one that came first).
 */
export function spreadCategories<T extends { category: string }>(items: readonly T[]): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length) {
    const prev = out.at(-1)?.category;
    const left = new Map<string, number>();
    for (const m of rest) left.set(m.category, (left.get(m.category) ?? 0) + 1);
    let best = -1;
    rest.forEach((m, i) => {
      if (m.category === prev) return;
      if (best < 0 || left.get(m.category)! > left.get(rest[best]!.category)!) best = i;
    });
    // Only the previous topic is left: nothing to spread any more.
    out.push(rest.splice(best < 0 ? 0 : best, 1)[0]!);
  }
  return out;
}

/**
 * The pictures of a round: mode filter, never one played in this session
 * (room), weighted by difficulty, Party: at least the party share from the
 * party pool – then mixed by topic.
 */
export function pickMotifs(
  pool: readonly PixelpanikMotif[],
  options: ModuleInitOptions,
  random: () => number,
): PixelpanikMotif[] {
  const mode = options.mode ?? { mode: "family", allow16: false, difficulty: "mixed" };
  const blocked = options.blockedContentIds;
  const played = new Set([...options.excludeContentIds, ...(options.currentGameContentIds ?? [])]);
  const candidates = playableMotifs(pool).filter(
    (m) => motifFitsMode(m, mode) && eligibleForMode(motifFlags(m), mode, pixelpanikMeta) && !blocked?.has(m.id) && !played.has(m.id),
  );
  const pickable = candidates.map((m) => ({ id: m.id, difficulty: DIFFICULTY[m.difficulty], adult: isPartyMotif(m), motif: m }));
  const weight = (p: (typeof pickable)[number]) => difficultyWeight(p.difficulty, mode);
  const picked = selectWithPartyShare(
    pickable,
    options.questionCount,
    { ...options, mode, excludeContentIds: [] },
    random,
    "pixelpanik",
    (items, n) => pickSpread(weightedShuffle(items, weight, random), n, (p) => p.motif.category),
  );
  return spreadCategories(picked.map((p) => p.motif));
}

/**
 * `n` of the (already shuffled) items, as few as possible per topic: at
 * most ceil(n / topics) each, raised only when there is nothing else left.
 */
export function pickSpread<T>(items: readonly T[], n: number, topic: (item: T) => string): T[] {
  const topics = new Set(items.map(topic)).size;
  const out: T[] = [];
  const count = new Map<string, number>();
  for (let cap = Math.ceil(n / Math.max(1, topics)); out.length < Math.min(n, items.length); cap++) {
    for (const item of items) {
      if (out.length >= n) break;
      const t = topic(item);
      if (out.includes(item) || (count.get(t) ?? 0) >= cap) continue;
      out.push(item);
      count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  return out;
}

export function prepareMotif(m: PixelpanikMotif, random: () => number): PreparedMotif {
  const choices = m.kids_choices ? shuffle(m.kids_choices, random) : null;
  return {
    id: m.id,
    category: m.category,
    answer: m.answer,
    terms: termsOf(m),
    choices,
    correctChoice: choices ? choices.indexOf(m.answer) : null,
    stages: [...(m.image?.stages ?? [])],
    source: m.image?.source ?? null,
    party: isPartyMotif(m),
  };
}

/** Points per stage and ms per stage from the host's settings. */
export function stageSettings(scoring: ModuleInitOptions["scoring"]): { points: number[]; stageMs: number } {
  const s = normalizeScoring(pixelpanikMeta, scoring);
  const points = PIXELPANIK_STAGES.map((stage) => s.points?.[stage.id] ?? pixelpanikMeta.scoring.points[stage.id]);
  const raw = s.points?.stageSeconds ?? PIXELPANIK_CONFIG.defaultStageSeconds;
  const seconds = Math.min(PIXELPANIK_CONFIG.maxStageSeconds, Math.max(PIXELPANIK_CONFIG.minStageSeconds, Math.round(raw)));
  return { points, stageMs: seconds * 1000 };
}

function contentEntry(m: PixelpanikMotif): ContentEntry {
  const flags = motifFlags(m);
  return {
    id: m.id,
    text: `Bild: ${m.category}`,
    answer: [m.answer, ...m.synonyms].join(" / "),
    difficulty: flags.difficulty,
    ageRating: flags.ageRating,
    tags: [m.category],
    payload: m,
    adult: flags.adult,
    ...(m.image?.source ? { source: m.image.source.url } : {}),
  };
}

export interface PixelpanikModuleOptions {
  pool?: readonly PixelpanikMotif[];
}

export function createPixelpanikModule(opts: PixelpanikModuleOptions = {}): PixelpanikModule {
  const pool = opts.pool ?? PIXELPANIK_MOTIFS;
  // The guard compares a guess with EVERY motif ("Irland" is no typo of "Island").
  const catalog: MatchCatalog = buildCatalog(pool);
  const wrongAnswers = pool.map((m) => m.answer);

  const actionSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("guess"), text: z.string().trim().min(1).max(PIXELPANIK_CONFIG.maxGuessLength) }),
    z.object({ type: z.literal("choice"), index: z.number().int().min(0).max(3) }),
  ]) as z.ZodType<PixelpanikAction>;

  // ── helpers on a draft (entry points work on a copy) ──

  function emit(s: PixelpanikState, event: Omit<PixelpanikEvent, "seq" | "index">) {
    s.eventSeq += 1;
    s.events = [...s.events, { ...event, index: s.index, seq: s.eventSeq }].slice(-MAX_EVENTS);
  }

  const freshRun = (): PixelpanikPlayerRun => ({
    status: "open",
    correctStage: null,
    at: null,
    guess: null,
    wrongChoices: [],
    lockedStage: null,
  });

  function openImage(state: PixelpanikState, index: number, ctx: ModuleContext): ModuleUpdate<PixelpanikState> {
    const next: PixelpanikState = {
      ...state,
      index,
      step: "stage",
      stage: 0,
      imageStartedAt: ctx.now,
      stageStartedAt: ctx.now,
      stepEndsAt: ctx.now + state.stageMs,
      players: Object.fromEntries(ctx.players.map((p) => [p.id, freshRun()])),
      results: null,
    };
    return { state: next, phaseEndsAt: next.stepEndsAt };
  }

  /** Everyone who is connected is done (right, or out) – disconnected players don't block. */
  function allDone(state: PixelpanikState, ctx: ModuleContext): boolean {
    const connected = ctx.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => {
      const run = state.players[p.id];
      return run?.status === "correct" || run?.status === "out";
    });
  }

  function nextStage(state: PixelpanikState, ctx: ModuleContext): ModuleUpdate<PixelpanikState> {
    if (state.stage >= LAST_STAGE) return reveal(state, ctx);
    const s: PixelpanikState = { ...state, stage: state.stage + 1, stageStartedAt: ctx.now, stepEndsAt: ctx.now + state.stageMs };
    // Stage 2 and nobody has even tried: the host picks on someone.
    const quiet = Object.values(s.players).every((r) => r.guess === null);
    if (s.stage === 1 && quiet) {
      const target = botPick(ctx.players.filter((p) => p.connected && s.players[p.id]), ctx.random);
      if (target) emit(s, { type: "NOBODY_YET", at: ctx.now, stage: s.stage, playerId: target.id });
    }
    return { state: s, phaseEndsAt: s.stepEndsAt };
  }

  function reveal(state: PixelpanikState, ctx: ModuleContext): ModuleUpdate<PixelpanikState> {
    const results: Record<string, number> = {};
    for (const [id, run] of Object.entries(state.players)) {
      if (run.status === "correct" && run.correctStage !== null) results[id] = state.points[run.correctStage] ?? 0;
    }
    const s: PixelpanikState = { ...state, step: "reveal", results, stepEndsAt: ctx.now + PIXELPANIK_CONFIG.revealMs };
    if (Object.keys(results).length === 0) emit(s, { type: "NOBODY", at: ctx.now, stage: s.stage });
    // Always set (even if empty): the room builds the leaderboard snapshot from it.
    const scoreDelta = Object.fromEntries(Object.entries(results).filter(([, p]) => p > 0));
    return { state: s, phaseEndsAt: s.stepEndsAt, scoreDelta };
  }

  function guessEvent(stage: number): PixelpanikEvent["type"] {
    if (stage < PIXELPANIK_CONFIG.earlyStages) return "EARLY_CORRECT";
    if (stage === LAST_STAGE) return "LATE_CORRECT";
    return "CORRECT";
  }

  function publicStatus(state: PixelpanikState, run: PixelpanikPlayerRun | undefined): PixelpanikPlayerStatus {
    if (!run) return "open";
    if (run.status === "open" && state.input === "choice" && run.lockedStage === state.stage) return "locked";
    return run.status;
  }

  return {
    meta: pixelpanikMeta,
    actionSchema,

    init(ctx, options) {
      const { points, stageMs } = stageSettings(options.scoring);
      const input: PixelpanikInput = options.mode?.mode === "kids" ? "choice" : "text";
      const motifs = pickMotifs(pool, options, ctx.random).map((m) => prepareMotif(m, ctx.random));
      const initial: PixelpanikState = {
        motifs,
        index: 0,
        step: "stage",
        input,
        stage: 0,
        imageStartedAt: ctx.now,
        stageStartedAt: ctx.now,
        stepEndsAt: ctx.now,
        stageMs,
        points,
        players: {},
        results: null,
        events: [],
        eventSeq: 0,
        roundKey: `${ctx.now}:${motifs.map((m) => m.id).join(",")}`,
      };
      if (motifs.length === 0) {
        options.log?.("pixelpanik: no playable motifs (did the image script run?)", { mode: options.mode?.mode ?? "family" });
        return { state: initial, phaseEndsAt: null, done: true };
      }
      return { ...openImage(initial, 0, ctx), usedContentIds: motifs.map((m) => m.id) };
    },

    handleAction(state, action, playerId, ctx) {
      if (state.step !== "stage") return { error: "WRONG_PHASE" };
      // Between two stages a guess counts for the stage still showing – only after the last one it is too late.
      if (state.stage === LAST_STAGE && ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
      if (!ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" };
      const motif = state.motifs[state.index]!;
      const run = state.players[playerId] ?? freshRun();
      if (run.status !== "open") return { error: "ALREADY_ANSWERED" };
      const s: PixelpanikState = { ...state, players: { ...state.players } };

      if (state.input === "text") {
        if (action.type !== "guess") return { error: "WRONG_PHASE" };
        const correct = isCorrectGuess(action.text, motif.id, catalog, motif.terms);
        s.players[playerId] = {
          ...run,
          status: correct ? "correct" : "out",
          correctStage: correct ? state.stage : null,
          at: ctx.now,
          guess: action.text.trim(),
        };
        emit(s, { type: correct ? guessEvent(state.stage) : "WRONG", at: ctx.now, stage: state.stage, playerId });
      } else {
        if (action.type !== "choice" || !motif.choices) return { error: "WRONG_PHASE" };
        if (run.lockedStage === state.stage || run.wrongChoices.includes(action.index)) return { error: "ALREADY_ANSWERED" };
        const correct = action.index === motif.correctChoice;
        s.players[playerId] = correct
          ? { ...run, status: "correct", correctStage: state.stage, at: ctx.now, guess: motif.choices[action.index] ?? null }
          : {
              ...run,
              guess: motif.choices[action.index] ?? null,
              wrongChoices: [...run.wrongChoices, action.index],
              lockedStage: state.stage,
            };
        emit(s, { type: correct ? guessEvent(state.stage) : "WRONG", at: ctx.now, stage: state.stage, playerId });
      }
      if (allDone(s, ctx)) return reveal(s, ctx);
      return { state: s, phaseEndsAt: s.stepEndsAt };
    },

    onTimer(state, ctx) {
      if (state.step === "stage") return nextStage(state, ctx);
      if (state.step === "reveal") {
        const s: PixelpanikState = { ...state, step: "leaderboard", stepEndsAt: ctx.now + REVEAL_LEADERBOARD_MS };
        return { state: s, phaseEndsAt: s.stepEndsAt };
      }
      const nextIndex = state.index + 1;
      if (nextIndex < state.motifs.length) return openImage(state, nextIndex, ctx);
      return { state, phaseEndsAt: null, done: true };
    },

    onPlayersChanged(state, ctx) {
      if (state.step === "stage" && allDone(state, ctx)) return reveal(state, ctx);
      return null;
    },

    progress(state) {
      return {
        index: state.index,
        total: state.motifs.length,
        // One step per stage: test bots get a new chance to guess in every stage.
        step: state.step === "stage" ? `stage-${state.stage + 1}` : state.step,
        contentId: state.motifs[state.index]?.id,
        revealed: state.step !== "stage",
      };
    },

    toStats(state, exclude) {
      if (state.step === "stage") return null;
      const motif = state.motifs[state.index];
      if (!motif) return null;
      const runs = Object.entries(state.players).filter(([id, r]) => !exclude?.has(id) && r.guess !== null);
      if (exclude?.size && runs.length === 0) return null;
      return {
        contentId: motif.id,
        answers: runs.length,
        correct: runs.filter(([, r]) => r.status === "correct").length,
        sumResponseMs: runs.reduce((sum, [, r]) => sum + Math.max(0, (r.at ?? state.stepEndsAt) - state.imageStartedAt), 0),
        sumErrorPct: null,
        extra: Object.fromEntries(
          PIXELPANIK_STAGES.map((stage, i) => [stage.id, runs.filter(([, r]) => r.correctStage === i).length]),
        ),
      };
    },

    botAction(state, botId, _ctx, bot) {
      const motif = state.motifs[state.index];
      const run = state.players[botId];
      if (state.step !== "stage" || !motif || !run || run.status !== "open") return null;
      if (state.input === "choice" && run.lockedStage === state.stage) return null;
      const chance = PIXELPANIK_CONFIG.botGuessChance[state.stage] ?? 1;
      if (bot.random() >= chance) return null;
      if (state.input === "choice" && motif.choices && motif.correctChoice !== null) {
        const open = motif.choices.map((_, i) => i).filter((i) => !run.wrongChoices.includes(i));
        const pick = botChoice(motif.correctChoice, motif.choices.length, bot);
        return { type: "choice", index: open.includes(pick) ? pick : motif.correctChoice };
      }
      const right = bot.random() < bot.correctRate;
      const text = right ? motif.answer : (botPick(wrongAnswers.filter((a) => a !== motif.answer), bot.random) ?? "Keine Ahnung");
      return { type: "guess", text };
    },

    listContent: () => playableMotifs(pool).map(contentEntry),
    parseContent: (raw: unknown) => parseWith(PixelpanikMotifSchema, raw),

    toPublicState(state, viewer: Viewer): PixelpanikPublicState {
      const motif = state.motifs[state.index];
      const revealed = state.step !== "stage";
      const shownStage = revealed ? LAST_STAGE : state.stage;
      const imageUrl = motif?.stages[shownStage];
      const own = viewer.role === "player" ? state.players[viewer.playerId] : undefined;
      return {
        step: state.step,
        index: state.index,
        total: state.motifs.length,
        input: state.input,
        stage: state.stage,
        stages: PIXELPANIK_STAGES.map((s, i) => ({ size: s.size, label: s.label, points: state.points[i] ?? 0 })),
        stageStartedAt: state.stageStartedAt,
        stepEndsAt: state.stepEndsAt,
        // The picture goes to the TV only – and only the current stage.
        image: viewer.role === "host" && imageUrl ? { url: imageUrl, size: PIXELPANIK_STAGES[shownStage]!.size } : null,
        // Only Kids get options – in free text they would give the answer away.
        choices: state.input === "choice" ? (motif?.choices ?? null) : null,
        players: Object.entries(state.players).map(([id, run]) => ({
          id,
          status: publicStatus(state, run),
          stage: run.correctStage,
          points: run.correctStage !== null ? (state.points[run.correctStage] ?? 0) : 0,
        })),
        me:
          viewer.role === "player"
            ? {
                status: publicStatus(state, own),
                guess: own?.guess ?? null,
                wrongChoices: own?.wrongChoices ?? [],
              }
            : null,
        reveal:
          revealed && motif
            ? {
                answer: motif.answer,
                source: motif.source ?? null,
                results: Object.fromEntries(
                  Object.entries(state.players).map(([id, run]) => [
                    id,
                    {
                      guess: run.guess,
                      correct: run.status === "correct",
                      stage: run.correctStage,
                      points: state.results?.[id] ?? 0,
                    },
                  ]),
                ),
              }
            : null,
      };
    },
  };
}

export const pixelpanikModule = createPixelpanikModule();
