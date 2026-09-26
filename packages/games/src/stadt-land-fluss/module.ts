/**
 * Stadt, Land, Fluss – server-authoritative logic (pure, no I/O, no timers).
 *
 * Per letter: intro → write → check (AI) → script (AI gags) → reveal →
 * vote → tally → leaderboard.
 *
 * - Phones save their answers while typing (a dropped phone keeps what it
 *   had). Whoever filled every field may shout "Stopp!": everyone else gets
 *   `stopSeconds` more – the same `stepEndsAt` for every screen.
 * - One AI call checks every answer of the letter (strong model); another
 *   writes ONE gag per category (fast model). Both fall back: without the
 *   check only the first letter counts, without gags the host reads the
 *   answers alone.
 * - The reveal is one step: the host reads category by category (the TV
 *   follows the voice's cue, or its own timing when the voice is silent).
 * - The funniest "kreativ" answer (vote, never your own) earns a bonus.
 *   All points of a letter are booked at the tally.
 */
import { SLF_DATA_DE, type SlfCategory, type SlfFile } from "@couch-clash/content";
import {
  REVEAL_LEADERBOARD_MS,
  botPick,
  type GameMode,
  type GameModule,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type ReadAloud,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { normalizeScoring } from "../scoring/normalize";
import { buildCheckPrompt, judgeAnswers, judgeLetter, parseCheckReply, type JudgedAnswer, type SlfPoints } from "./judge";
import { SLF_CONFIG, SLF_DEFAULTS, slfMeta } from "./meta";
import { categoriesForMode, categoryContentId, letterContentId, lettersForMode, pickCategories, pickLetters } from "./pick";
import {
  NOBODY_LINES,
  TIME_UP_LINE,
  VOTE_LINE,
  buildGagPrompt,
  categoryHeader,
  letterLine,
  listingText,
  nobodyAnswered,
  parseGagReply,
  stopLine,
  type ScriptAnswer,
} from "./script";
import { cleanAnswer, spokenAnswer, spokenName } from "./text";
import type { SlfAction, SlfPublicAnswer, SlfPublicState, SlfStep } from "./types";

export interface SlfLetterRound {
  letter: string;
  categories: SlfCategory[];
}

/** What the host says about one category. */
export interface SlfScript {
  /** Every answer + the gag (or the nobody line). Shown on the TV as text, too. */
  text: string;
  /** Read-out pieces: the listing with the gag, or header + fixed nobody line (cached). */
  items: { text: string; fixed: boolean }[];
  /** Voice-silent timing: ms this category is shown. */
  ms: number;
}

export interface SlfCandidate {
  category: number;
  text: string;
  authors: string[];
}

export interface SlfState {
  mode: GameMode;
  rounds: SlfLetterRound[];
  index: number;
  step: SlfStep;
  stepStartedAt: number;
  stepEndsAt: number;
  writeMs: number;
  stopMs: number;
  points: SlfPoints;
  /** Players of this letter, in reading order (set when the writing ends). */
  participants: string[];
  /** Saved answers per player (one per category, "" = empty). */
  answers: Record<string, string[]>;
  stop: { playerId: string; at: number } | null;
  judged: Record<string, JudgedAnswer[]> | null;
  aiChecked: boolean;
  scripts: SlfScript[] | null;
  candidates: SlfCandidate[] | null;
  votes: Record<string, { candidate: number; at: number }>;
  tally: SlfPublicState["tally"];
  /** "Die witzigste Antwort: … – von Max!" (null: nobody voted). */
  tallyLine: string | null;
  /** Identifies this round (the voice prepares its fixed lines per round). */
  roundKey: string;
}

export type SlfModule = GameModule<SlfState, SlfAction, SlfPublicState>;

const REVEALED: readonly SlfStep[] = ["reveal", "vote", "tally", "leaderboard"];

const answersSchema = z.array(z.string().max(200)).max(SLF_CONFIG.maxCategories);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answers"), answers: answersSchema }),
  z.object({ type: z.literal("stop"), answers: answersSchema }),
  z.object({ type: z.literal("vote"), candidate: z.number().int().min(0).max(500) }),
]) as z.ZodType<SlfAction>;

const clampInt = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value! : fallback)));

/** Points, categories per letter and timings from the host's settings (kids get their own). */
export function slfSettings(scoring: ModuleInitOptions["scoring"], mode: GameMode) {
  const p = normalizeScoring(slfMeta, scoring).points ?? {};
  const kids = mode === "kids";
  const c = SLF_CONFIG;
  return {
    points: {
      only: clampInt(p.only, SLF_DEFAULTS.only, 0, 10_000),
      unique: clampInt(p.unique, SLF_DEFAULTS.unique, 0, 10_000),
      duplicate: clampInt(p.duplicate, SLF_DEFAULTS.duplicate, 0, 10_000),
      vote: clampInt(p.vote, SLF_DEFAULTS.vote, 0, 10_000),
    },
    categories: kids
      ? clampInt(p.categoriesKids, SLF_DEFAULTS.categoriesKids, c.minCategories, c.maxCategories)
      : clampInt(p.categoriesAdults, SLF_DEFAULTS.categoriesAdults, c.minCategories, c.maxCategories),
    writeMs:
      1000 *
      (kids
        ? clampInt(p.secondsKids, SLF_DEFAULTS.secondsKids, c.minSeconds, c.maxSeconds)
        : clampInt(p.secondsAdults, SLF_DEFAULTS.secondsAdults, c.minSeconds, c.maxSeconds)),
    stopMs: 1000 * clampInt(p.stopSeconds, SLF_DEFAULTS.stopSeconds, c.minStopSeconds, c.maxStopSeconds),
  };
}

/** Letters and categories of a round (mode filter: party categories only in Party mode). */
export function planLetters(data: SlfFile, options: ModuleInitOptions, random: () => number, categoriesPerLetter: number): SlfLetterRound[] {
  const mode = options.mode?.mode ?? "family";
  const pool = categoriesForMode(data, mode);
  const letters = pickLetters(lettersForMode(data, mode), Math.max(0, options.questionCount), options, random);
  const used = [...(options.currentGameContentIds ?? []), ...options.excludeContentIds];
  const rounds: SlfLetterRound[] = [];
  for (const letter of letters) {
    const categories = pickCategories(pool, Math.min(categoriesPerLetter, pool.length), mode, data.mix, used, random);
    used.push(...categories.map((c) => categoryContentId(c.id)));
    rounds.push({ letter, categories });
  }
  return rounds;
}

/** Voice-silent timing for one category. */
export function revealMs(text: string): number {
  return Math.max(SLF_CONFIG.revealMinMsPerCategory, SLF_CONFIG.revealLeadMs + text.length * SLF_CONFIG.revealMsPerChar);
}

export interface SlfModuleOptions {
  data?: SlfFile;
}

export function createSlfModule(opts: SlfModuleOptions = {}): SlfModule {
  const data = opts.data ?? SLF_DATA_DE;

  const at = (state: SlfState, step: SlfStep, now: number, ms: number): SlfState => ({
    ...state,
    step,
    stepStartedAt: now,
    stepEndsAt: now + ms,
  });
  const update = (state: SlfState, extra: Partial<ModuleUpdate<SlfState>> = {}): ModuleUpdate<SlfState> => ({
    state,
    phaseEndsAt: state.stepEndsAt,
    ...extra,
  });

  const current = (state: SlfState) => state.rounds[state.index]!;

  function openLetter(state: SlfState, index: number, now: number): ModuleUpdate<SlfState> {
    const next: SlfState = {
      ...state,
      index,
      participants: [],
      answers: {},
      stop: null,
      judged: null,
      aiChecked: false,
      scripts: null,
      candidates: null,
      votes: {},
      tally: null,
      tallyLine: null,
    };
    return update(at(next, "intro", now, SLF_CONFIG.introMs));
  }

  /** One answer per category, cleaned ("" = empty). */
  function normalizeAnswers(state: SlfState, raw: readonly string[]): string[] {
    return current(state).categories.map((_, i) => cleanAnswer(raw[i] ?? ""));
  }

  const filledAll = (answers: readonly string[] | undefined) => !!answers && answers.length > 0 && answers.every((a) => a.length > 0);

  /** Players of this letter: everyone still in the room, plus whoever saved answers. */
  function participantsOf(state: SlfState, ctx: ModuleContext): string[] {
    const inRoom = ctx.players.map((p) => p.id);
    const extra = Object.keys(state.answers).filter((id) => !inRoom.includes(id));
    return [...inRoom, ...extra.filter((id) => state.answers[id]!.some((a) => a))];
  }

  /** Writing is over: the AI check – or straight to the reveal when nobody wrote anything checkable. */
  function endWriting(state: SlfState, ctx: ModuleContext): ModuleUpdate<SlfState> {
    const s: SlfState = { ...state, participants: participantsOf(state, ctx) };
    const round = current(s);
    if (judgeAnswers(round.categories.length, s.answers, s.participants, round.letter).length === 0) {
      return reveal(withJudged(s, null), null, ctx);
    }
    return update(at(s, "check", ctx.now, SLF_CONFIG.checkMaxMs));
  }

  function withJudged(state: SlfState, ai: ReturnType<typeof parseCheckReply>): SlfState {
    const round = current(state);
    const judged = judgeLetter({
      letter: round.letter,
      categories: round.categories,
      order: state.participants,
      answers: state.answers,
      ai,
      points: state.points,
    });
    return { ...state, judged, aiChecked: ai !== null };
  }

  const nameOf = (ctx: ModuleContext, id: string) => spokenName(ctx.players.find((p) => p.id === id)?.name);

  function scriptAnswers(state: SlfState, c: number, ctx: ModuleContext): ScriptAnswer[] {
    return state.participants.map((id) => ({
      name: nameOf(ctx, id),
      text: state.answers[id]?.[c] ?? "",
      judged: state.judged![id]![c]!,
    }));
  }

  /** The host's texts: every answer per category, with a gag when there is one. */
  function buildScripts(state: SlfState, gags: ReadonlyMap<number, string>, ctx: ModuleContext): SlfScript[] {
    const round = current(state);
    return round.categories.map((category, c) => {
      const answers = scriptAnswers(state, c, ctx);
      if (nobodyAnswered(answers)) {
        const header = `${categoryHeader(category.label, round.letter)}?`;
        const line = botPick(NOBODY_LINES[state.mode], ctx.random) ?? NOBODY_LINES.family[0]!;
        const text = `${header} ${line}`;
        return { text, items: [{ text: header, fixed: false }, { text: line, fixed: true }], ms: revealMs(text) };
      }
      const listing = listingText(category.label, round.letter, answers, ctx.random);
      const gag = gags.get(c);
      const text = gag ? `${listing} ${gag}` : listing;
      return { text, items: [{ text, fixed: false }], ms: revealMs(text) };
    });
  }

  function reveal(state: SlfState, gags: ReadonlyMap<number, string> | null, ctx: ModuleContext): ModuleUpdate<SlfState> {
    const scripts = buildScripts(state, gags ?? new Map(), ctx);
    const ms = scripts.reduce((sum, s) => sum + s.ms, 0);
    return update(at({ ...state, scripts }, "reveal", ctx.now, ms));
  }

  function gagCategories(state: SlfState) {
    const round = current(state);
    return round.categories.map((category, c) => ({
      label: category.label,
      ...(category.hint ? { hint: category.hint } : {}),
      type: category.type,
      answers: state.participants.map((id, p) => ({
        token: `P${p + 1}`,
        text: spokenAnswer(state.answers[id]?.[c] ?? ""),
        judged: state.judged![id]![c]!,
      })),
    }));
  }

  const taskBase = (state: SlfState) => `${state.roundKey}:${state.index}`;

  function checkTask(state: SlfState) {
    const round = current(state);
    const answers = judgeAnswers(round.categories.length, state.answers, state.participants, round.letter);
    return {
      id: `slf-check:${taskBase(state)}`,
      kind: "llm_json" as const,
      input: buildCheckPrompt(round.letter, round.categories, answers, state.mode),
      timeoutMs: SLF_CONFIG.checkTimeoutMs,
      model: "strong" as const,
    };
  }

  function scriptTask(state: SlfState) {
    return {
      id: `slf-script:${taskBase(state)}`,
      kind: "llm_json" as const,
      input: buildGagPrompt(current(state).letter, gagCategories(state), state.mode),
      timeoutMs: SLF_CONFIG.scriptTimeoutMs,
      model: "fast" as const,
    };
  }

  /** "kreativ" answers everyone may vote for – the same answer of several players is one candidate. */
  function buildCandidates(state: SlfState): SlfCandidate[] {
    const round = current(state);
    const out: SlfCandidate[] = [];
    round.categories.forEach((category, c) => {
      if (category.type !== "kreativ") return;
      const groups = new Map<string, SlfCandidate>();
      for (const id of state.participants) {
        const judged = state.judged?.[id]?.[c];
        const text = state.answers[id]?.[c] ?? "";
        if (judged?.verdict !== "valid" || !text) continue;
        const key = judged.normalized.toLocaleLowerCase("de");
        const known = groups.get(key);
        if (known) known.authors.push(id);
        else groups.set(key, { category: c, text, authors: [id] });
      }
      out.push(...groups.values());
    });
    return out;
  }

  const canVoteFor = (state: SlfState, playerId: string) =>
    !!state.candidates?.some((c) => !c.authors.includes(playerId)) && state.participants.includes(playerId);

  const voters = (state: SlfState, ctx: ModuleContext) => ctx.players.filter((p) => p.connected && canVoteFor(state, p.id));

  function allVoted(state: SlfState, ctx: ModuleContext) {
    const eligible = voters(state, ctx);
    return eligible.length > 0 && eligible.every((p) => p.id in state.votes);
  }

  function afterReveal(state: SlfState, ctx: ModuleContext): ModuleUpdate<SlfState> {
    const candidates = buildCandidates(state);
    const s: SlfState = { ...state, candidates };
    if (state.points.vote > 0 && candidates.length > 0 && voters(s, ctx).length > 0) {
      return update(at(s, "vote", ctx.now, SLF_CONFIG.voteSeconds * 1000));
    }
    return tally(s, ctx);
  }

  /** Winners of the vote and every player's points of this letter – booked now. */
  function tally(state: SlfState, ctx: ModuleContext): ModuleUpdate<SlfState> {
    const counts = new Map<number, number>();
    for (const v of Object.values(state.votes)) counts.set(v.candidate, (counts.get(v.candidate) ?? 0) + 1);
    const best = Math.max(0, ...counts.values());
    const winners: NonNullable<SlfPublicState["tally"]>["winners"] = [];
    if (best > 0) {
      for (const [candidate, votes] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
        if (votes !== best) continue;
        for (const playerId of state.candidates?.[candidate]?.authors ?? []) winners.push({ candidate, playerId, votes });
      }
    }
    const bonus = new Set(winners.map((w) => w.playerId));
    const points: NonNullable<SlfPublicState["tally"]>["points"] = {};
    const scoreDelta: Record<string, number> = {};
    for (const id of state.participants) {
      const categories = (state.judged?.[id] ?? []).reduce((sum, j) => sum + j.points, 0);
      const vote = bonus.has(id) ? state.points.vote : 0;
      points[id] = { categories, vote, total: categories + vote };
      if (categories + vote > 0) scoreDelta[id] = categories + vote;
    }
    // Per winning answer: "Duschkopf von Max" (a tie names every winning answer).
    const won = [...new Set(winners.map((w) => w.candidate))].map((i) => {
      const names = winners.filter((w) => w.candidate === i).map((w) => nameOf(ctx, w.playerId));
      return `${spokenAnswer(state.candidates![i]!.text)} – von ${names.join(" und ")}`;
    });
    const tallyLine =
      won.length === 0 ? null : won.length === 1 ? `Die witzigste Antwort: ${won[0]}!` : `Gleichstand! Die witzigsten Antworten: ${won.join("; und ")}!`;
    // Always set (even if empty): the room builds the leaderboard snapshot from it.
    return update(at({ ...state, tally: { winners, points }, tallyLine }, "tally", ctx.now, SLF_CONFIG.tallyMs), { scoreDelta });
  }

  function publicAnswers(state: SlfState, c: number): SlfPublicAnswer[] {
    return state.participants.map((id) => {
      const j = state.judged?.[id]?.[c];
      const verdict = j?.verdict ?? "empty";
      return {
        playerId: id,
        text: verdict === "censored" ? "" : (state.answers[id]?.[c] ?? ""),
        verdict,
        points: j?.points ?? 0,
        duplicate: !!j?.duplicate,
        only: !!j?.only,
        typo: !!j?.typo,
      };
    });
  }

  return {
    meta: slfMeta,
    actionSchema,

    init(ctx, options) {
      const mode = options.mode?.mode ?? "family";
      const settings = slfSettings(options.scoring, mode);
      const rounds = planLetters(data, options, ctx.random, settings.categories);
      const initial: SlfState = {
        mode,
        rounds,
        index: 0,
        step: "intro",
        stepStartedAt: ctx.now,
        stepEndsAt: ctx.now,
        writeMs: settings.writeMs,
        stopMs: settings.stopMs,
        points: settings.points,
        participants: [],
        answers: {},
        stop: null,
        judged: null,
        aiChecked: false,
        scripts: null,
        candidates: null,
        votes: {},
        tally: null,
        tallyLine: null,
        roundKey: `${ctx.now}:${rounds.map((r) => r.letter).join("")}`,
      };
      if (rounds.length === 0 || rounds.some((r) => r.categories.length === 0)) {
        options.log?.("stadt-land-fluss: no letters or categories for this mode", { mode });
        return { state: initial, phaseEndsAt: null, done: true };
      }
      const usedContentIds = rounds.flatMap((r) => [letterContentId(r.letter), ...r.categories.map((c) => categoryContentId(c.id))]);
      return { ...openLetter(initial, 0, ctx.now), usedContentIds };
    },

    handleAction(state, action, playerId, ctx) {
      if (!ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" };
      if (action.type === "vote") {
        if (state.step !== "vote") return { error: "WRONG_PHASE" };
        if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
        if (playerId in state.votes) return { error: "ALREADY_ANSWERED" };
        const candidate = state.candidates?.[action.candidate];
        if (!candidate) return { error: "INVALID_MESSAGE" };
        if (candidate.authors.includes(playerId)) return { error: "OWN_ANSWER" };
        if (!canVoteFor(state, playerId)) return { error: "WRONG_PHASE" };
        const next: SlfState = { ...state, votes: { ...state.votes, [playerId]: { candidate: action.candidate, at: ctx.now } } };
        return allVoted(next, ctx) ? tally(next, ctx) : update(next);
      }
      if (state.step !== "write") return { error: "WRONG_PHASE" };
      if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
      const answers = normalizeAnswers(state, action.answers);
      const next: SlfState = { ...state, answers: { ...state.answers, [playerId]: answers } };
      if (action.type === "answers") return update(next);
      // "Stopp!" – only with every field filled, only once per letter.
      if (state.stop) return { error: "TOO_LATE" };
      if (!filledAll(answers)) return { error: "INVALID_MESSAGE" };
      const others = ctx.players.filter((p) => p.connected && p.id !== playerId);
      if (others.length === 0) return endWriting(next, ctx);
      const stopped: SlfState = {
        ...next,
        stop: { playerId, at: ctx.now },
        stepEndsAt: Math.min(state.stepEndsAt, ctx.now + state.stopMs),
      };
      return update(stopped);
    },

    onTimer(state, ctx) {
      switch (state.step) {
        case "intro":
          return update(at(state, "write", ctx.now, state.writeMs));
        case "write":
          return endWriting(state, ctx);
        case "check":
          // No usable AI answer in time: only the first letter counts, no gags.
          return reveal(withJudged(state, null), null, ctx);
        case "script":
          return reveal(state, null, ctx);
        case "reveal":
          return afterReveal(state, ctx);
        case "vote":
          return tally(state, ctx);
        case "tally":
          return update(at(state, "leaderboard", ctx.now, REVEAL_LEADERBOARD_MS));
        case "leaderboard": {
          const nextIndex = state.index + 1;
          if (nextIndex < state.rounds.length) return openLetter(state, nextIndex, ctx.now);
          return { state, phaseEndsAt: null, done: true };
        }
      }
    },

    onPlayersChanged(state, ctx) {
      if (state.step === "vote" && allVoted(state, ctx)) return tally(state, ctx);
      return null;
    },

    pendingTask(state) {
      if (state.step === "check") return checkTask(state);
      if (state.step === "script") return scriptTask(state);
      return null;
    },

    resolveTask(state, taskId, result, ctx) {
      if (state.step === "check" && taskId === checkTask(state).id) {
        const round = current(state);
        const answers = judgeAnswers(round.categories.length, state.answers, state.participants, round.letter);
        const ai = result == null ? null : parseCheckReply(result, answers);
        const judged = withJudged(state, ai);
        // The check failed: the host reads without gags.
        if (!ai) return reveal(judged, null, ctx);
        return update(at(judged, "script", ctx.now, SLF_CONFIG.scriptMaxMs));
      }
      if (state.step === "script" && taskId === scriptTask(state).id) {
        const names = new Map(state.participants.map((id, p) => [`P${p + 1}`, nameOf(ctx, id)]));
        const gags = result == null ? null : parseGagReply(result, current(state).categories.length, names);
        return reveal(state, gags, ctx);
      }
      return null;
    },

    readAloud(state): ReadAloud | null {
      const round = current(state);
      const key = (name: string) => `slf:${taskBase(state)}:${name}`;
      switch (state.step) {
        case "intro":
          return { key: key("letter"), items: [{ cue: "letter", text: letterLine(round.letter) }] };
        case "write":
          return state.stop ? { key: key("stop"), items: [{ cue: "stop", text: stopLine(Math.round(state.stopMs / 1000)) }] } : null;
        case "check":
        case "script":
          return { key: key("time-up"), items: [{ cue: "time-up", text: TIME_UP_LINE }] };
        case "reveal":
          return {
            key: key("reveal"),
            items: (state.scripts ?? []).flatMap((s, c) => s.items.map((item) => ({ cue: `category:${c}`, text: item.text, ...(item.fixed ? {} : { long: true }) }))),
          };
        case "vote":
          return { key: key("vote"), items: [{ cue: "vote", text: VOTE_LINE }] };
        case "tally":
          return state.tallyLine ? { key: key("tally"), items: [{ cue: "tally", text: state.tallyLine, long: true }] } : null;
        default:
          return null;
      }
    },

    progress(state) {
      return {
        index: state.index,
        total: state.rounds.length,
        step: state.step,
        revealed: REVEALED.includes(state.step),
      };
    },

    botAction(state, botId, ctx, bot) {
      if (state.step === "write") {
        if (state.answers[botId]) return null;
        const round = current(state);
        const endings = ["ammer", "olle", "inka", "otto", "umpel", "asper", "eli", "ora"];
        const word = () => `${round.letter}${botPick(endings, bot.random) ?? "a"}`;
        // Alone: fill everything and shout "Stopp!" (nobody to wait for). With others: a few gaps, no stop.
        const alone = ctx.players.every((p) => p.id === botId || !p.connected);
        if (alone && !state.stop) return { type: "stop", answers: round.categories.map(word) };
        return { type: "answers", answers: round.categories.map(() => (bot.random() < 0.8 ? word() : "")) };
      }
      if (state.step !== "vote" || botId in state.votes || !canVoteFor(state, botId)) return null;
      const choices = (state.candidates ?? []).flatMap((c, i) => (c.authors.includes(botId) ? [] : [i]));
      const candidate = botPick(choices, bot.random);
      return candidate === undefined ? null : { type: "vote", candidate };
    },

    toPublicState(state, viewer: Viewer): SlfPublicState {
      const round = current(state);
      const me = viewer.role === "player" ? viewer.playerId : null;
      const revealed = REVEALED.includes(state.step) && !!state.scripts && !!state.judged;
      let offset = 0;
      const candidates = REVEALED.includes(state.step) && state.step !== "reveal" ? state.candidates : null;
      return {
        step: state.step,
        index: state.index,
        total: state.rounds.length,
        letter: round.letter,
        categories: round.categories.map((c) => ({ id: c.id, label: c.label, ...(c.hint ? { hint: c.hint } : {}), type: c.type })),
        stepStartedAt: state.stepStartedAt,
        stepEndsAt: state.stepEndsAt,
        writeSeconds: Math.round(state.writeMs / 1000),
        stopSeconds: Math.round(state.stopMs / 1000),
        stop: state.stop,
        donePlayerIds: Object.entries(state.answers).flatMap(([id, a]) => (filledAll(a) ? [id] : [])),
        startedPlayerIds: Object.entries(state.answers).flatMap(([id, a]) => (a.some((x) => x) ? [id] : [])),
        // Only the viewer's own answers – never someone else's before the reveal.
        myAnswers: me ? (state.answers[me] ?? null) : null,
        reveal: revealed
          ? {
              aiChecked: state.aiChecked,
              categories: round.categories.map((c, i) => {
                const script = state.scripts![i]!;
                const startsAtMs = offset;
                offset += script.ms;
                return { categoryId: c.id, answers: publicAnswers(state, i), script: script.text, startsAtMs };
              }),
            }
          : null,
        candidates: candidates ? candidates.map((c) => ({ categoryId: round.categories[c.category]!.id, text: c.text })) : null,
        myCandidates: me && candidates ? candidates.flatMap((c, i) => (c.authors.includes(me) ? [i] : [])) : [],
        canVote: !!me && state.step === "vote" && canVoteFor(state, me),
        votedPlayerIds: Object.keys(state.votes),
        myVote: me ? (state.votes[me]?.candidate ?? null) : null,
        tally: state.tally,
        points: state.points,
      };
    },
  };
}

export const slfModule = createSlfModule();
