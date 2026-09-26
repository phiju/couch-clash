/**
 * Survival-Finale – server-authoritative game logic (pure, no I/O, no timers).
 *
 * The main game's points become life energy (convertStartScores). Every
 * question: one answer per player, +bonus when fast and right, −penalty when
 * wrong, and from the decay threshold on the score melts every full second –
 * booked by the server's ticks (phaseEndsAt → the room's alarm → onTimer), so
 * a player who never answers still goes into the slime. Last one standing wins.
 *
 * The main game's scores (GameRecord.scores) are never touched: the finale
 * sends no scoreDelta; its placing is the elimination order (getFinalRanking).
 * Everything the screens and the moderator react to is in `events`.
 */
import type { EstimateQuestion } from "@couch-clash/content";
import {
  botChoice,
  botEstimate,
  type GameModule,
  type ModuleContext,
  type ModuleUpdate,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { estimateMeta } from "../estimate/meta";
import type { PreparedQuizQuestion } from "../knowledge/questions";
import { SURVIVAL_CONFIG, type DangerLevel, type SurvivalConfig } from "./config";
import { survivalMeta } from "./meta";
import {
  DEFAULT_SURVIVAL_POOLS,
  addAiQuestions,
  aiQuestionTask,
  aiTaskId,
  buildQuestionSource,
  drawEstimate,
  drawQuestion,
  type SurvivalQuestionPools,
  type SurvivalQuestionSource,
} from "./questions";
import {
  applyPhaseBaseDrain,
  calculateSurvivalScoreChange,
  calculateTimeDecay,
  convertStartScores,
  dangerRank,
  displayScore,
  escalateByQuestions,
  getAlivePlayers,
  getCurrentPhase,
  getDangerLevel,
  getFinalRanking,
  questionTimes,
  type EscalationRule,
} from "./rules";
import { defaultSuddenDeath, type SuddenDeathRule, type TiebreakAnswer, type TiebreakResult } from "./sudden-death";
import type {
  SurvivalAction,
  SurvivalEvent,
  SurvivalPublicPlayer,
  SurvivalPublicState,
  SurvivalRankingEntry,
  SurvivalScoreChange,
  SurvivalStep,
} from "./types";

export interface SurvivalPlayer {
  id: string;
  lane: number;
  mainScore: number;
  startScore: number;
  /** May go below 0 internally – shown as 0. */
  score: number;
  danger: DangerLevel;
  eliminatedAt: number | null;
  eliminatedQuestion: number | null;
  /** Kicked from the room: out, not ranked. */
  removed?: boolean;
  tiebreakPlace?: number | null;
}

export interface SurvivalAnswer {
  value: number;
  /** Server receive time. */
  at: number;
  correct: boolean;
  responseMs: number;
}

export interface SurvivalQuestionRun {
  /** 1-based, over the whole finale. */
  number: number;
  contentId: string;
  question: PreparedQuizQuestion;
  /** The phase is fixed when the question starts. */
  phaseIndex: number;
  startedAt: number;
  bonusUntil: number;
  decayFrom: number;
  timeoutAt: number;
  aliveAtStart: string[];
  /** Alive players at CRITICAL or worse when the question started. */
  criticalAtStart: number;
  answers: Record<string, SurvivalAnswer>;
  /** Decay already booked per player (idempotent: only the difference is ever deducted). */
  decayApplied: Record<string, number>;
  changes: Record<string, SurvivalScoreChange>;
  timedOut: string[];
  decayStarted: boolean;
  endedAt: number | null;
}

export interface SurvivalTiebreakRun {
  attempt: number;
  participants: string[];
  question: EstimateQuestion;
  startedAt: number;
  endsAt: number;
  answers: Record<string, TiebreakAnswer>;
  result: TiebreakResult | null;
}

export interface SurvivalState {
  config: SurvivalConfig;
  step: SurvivalStep;
  stepStartedAt: number;
  stepEndsAt: number;
  /** Lane order, left → right. */
  players: SurvivalPlayer[];
  phaseIndex: number;
  questionsPlayed: number;
  suddenDeaths: number;
  question: SurvivalQuestionRun | null;
  tiebreak: SurvivalTiebreakRun | null;
  winnerId: string | null;
  solo: boolean;
  ranking: SurvivalRankingEntry[] | null;
  events: SurvivalEvent[];
  eventSeq: number;
  /** Launch step: when the elevators start riding up (null: not yet). */
  launchRiseAt?: number | null;
  source: SurvivalQuestionSource;
}

export interface SurvivalModuleOptions {
  pools?: SurvivalQuestionPools;
  config?: Partial<SurvivalConfig>;
  escalation?: EscalationRule;
  suddenDeath?: SuddenDeathRule;
}

export type SurvivalModule = GameModule<SurvivalState, SurvivalAction, SurvivalPublicState>;

const DANGER_EVENTS: Partial<Record<DangerLevel, SurvivalEvent["type"]>> = {
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
  ELIMINATION_IMMINENT: "NEAR_ELIMINATION",
};

export function createSurvivalModule(opts: SurvivalModuleOptions = {}): SurvivalModule {
  const pools = opts.pools ?? DEFAULT_SURVIVAL_POOLS;
  const baseConfig: SurvivalConfig = { ...SURVIVAL_CONFIG, ...opts.config };
  const escalate = opts.escalation ?? escalateByQuestions;
  const suddenDeath = opts.suddenDeath ?? defaultSuddenDeath;

  const actionSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("answer"), value: z.number().int().min(0).max(3) }),
    z.object({ type: z.literal("estimate"), value: z.number().finite().min(-1e12).max(1e12) }),
  ]) as z.ZodType<SurvivalAction>;

  /** Content ids to report to the room (played in this update). */
  type Ops = { used: string[]; random: () => number };

  // ── helpers on a draft (every entry point works on a structuredClone) ──

  const find = (s: SurvivalState, id: string) => s.players.find((p) => p.id === id);
  const isOut = (p: SurvivalPlayer | undefined) => !p || p.removed || p.eliminatedAt !== null;

  function emit(s: SurvivalState, event: Omit<SurvivalEvent, "seq">) {
    s.eventSeq += 1;
    s.events.push({ ...event, seq: s.eventSeq });
    if (s.events.length > s.config.maxEvents) s.events.splice(0, s.events.length - s.config.maxEvents);
  }

  function addChange(q: SurvivalQuestionRun, id: string, part: Partial<SurvivalScoreChange>) {
    const c = q.changes[id] ?? { bonus: 0, decay: 0, penalty: 0, drain: 0, total: 0 };
    const next = {
      bonus: c.bonus + (part.bonus ?? 0),
      decay: c.decay + (part.decay ?? 0),
      penalty: c.penalty + (part.penalty ?? 0),
      drain: c.drain + (part.drain ?? 0),
      total: 0,
    };
    next.total = next.bonus - next.decay - next.penalty - next.drain;
    q.changes[id] = next;
  }

  /** The one place a score changes: danger events, then elimination at `at`. */
  function changeScore(s: SurvivalState, p: SurvivalPlayer, delta: number, at: number) {
    if (delta === 0 || p.eliminatedAt !== null) return;
    const before = p.score;
    const prev = p.danger;
    p.score += delta;
    p.danger = getDangerLevel(p.score, s.config);
    const common = { at, playerId: p.id, score: displayScore(p.score), previousScore: displayScore(before), danger: p.danger };
    if (dangerRank(p.danger) > dangerRank(prev)) {
      const type = DANGER_EVENTS[p.danger];
      if (type) emit(s, { type, ...common });
    } else if ((prev === "CRITICAL" || prev === "ELIMINATION_IMMINENT") && (p.danger === "WARNING" || p.danger === "SAFE")) {
      emit(s, { type: "COMEBACK", ...common });
    }
    if (p.score <= 0) {
      p.eliminatedAt = at;
      p.eliminatedQuestion = s.question?.number ?? null;
      emit(s, { type: "ELIMINATED", ...common, scoreChange: delta });
    }
  }

  /** Alive, in this question, no answer yet. */
  function waiting(s: SurvivalState, q: SurvivalQuestionRun): SurvivalPlayer[] {
    return q.aliveAtStart.flatMap((id) => {
      const p = find(s, id);
      return p && !isOut(p) && !(id in q.answers) ? [p] : [];
    });
  }

  /**
   * Books the decay up to `now` (never past the timeout) – only the
   * difference to what is booked already, so repeated ticks never double it.
   * A score that reaches 0 goes out at the exact second it did.
   */
  function settleDecay(s: SurvivalState, now: number) {
    const q = s.question;
    if (!q || q.endedAt !== null) return;
    const phase = getCurrentPhase(q.phaseIndex, s.config);
    const step = s.config.scoreDecayPerSecond;
    const t = Math.min(now, q.timeoutAt);
    const open = waiting(s, q);
    if (!q.decayStarted && t >= q.decayFrom && open.length > 0 && step > 0) {
      q.decayStarted = true;
      emit(s, { type: "TIME_DECAY_STARTED", at: q.decayFrom, playerIds: open.map((p) => p.id), phase: phase.id });
    }
    if (step <= 0) return;
    for (const p of open) {
      const applied = q.decayApplied[p.id] ?? 0;
      const target = calculateTimeDecay(t - q.startedAt, phase, s.config);
      if (target <= applied) continue;
      // Score before this question's decay (unanswered players have no other change yet).
      const before = p.score + applied;
      const charge = before - target <= 0 ? Math.ceil(before / step) * step : target;
      const at = q.decayFrom + (charge / step) * 1000;
      q.decayApplied[p.id] = charge;
      addChange(q, p.id, { decay: charge - applied });
      changeScore(s, p, -(charge - applied), at);
    }
  }

  const settled = (s: SurvivalState, q: SurvivalQuestionRun) => waiting(s, q).length === 0;

  function openQuestion(s: SurvivalState, now: number, ops: Ops): void {
    const drawn = drawQuestion(pools, s.source, ops.random, s.config);
    s.source = drawn.source;
    if (!drawn.question) return finishByScore(s, now);
    const phase = getCurrentPhase(s.phaseIndex, s.config);
    const alive = getAlivePlayers(s.players);
    s.question = {
      number: (s.question?.number ?? 0) + 1,
      contentId: drawn.question.id,
      question: drawn.question,
      phaseIndex: s.phaseIndex,
      startedAt: now,
      ...questionTimes(now, phase),
      aliveAtStart: alive.map((p) => p.id),
      criticalAtStart: alive.filter((p) => dangerRank(p.danger) >= dangerRank("CRITICAL")).length,
      answers: {},
      decayApplied: {},
      changes: {},
      timedOut: [],
      decayStarted: false,
      endedAt: null,
    };
    s.step = "question";
    s.stepStartedAt = now;
    s.stepEndsAt = s.question.timeoutAt;
    ops.used.push(drawn.question.id);
  }

  /** The question is over: no-answer penalty, DEATH MODE drain, then the reveal. */
  function endQuestion(s: SurvivalState, at: number, now: number) {
    const q = s.question!;
    const phase = getCurrentPhase(q.phaseIndex, s.config);
    settleDecay(s, at);
    const late = waiting(s, q);
    if (late.length > 0) {
      emit(s, { type: "TIMEOUT", at, playerIds: late.map((p) => p.id), phase: phase.id });
      for (const p of late) {
        q.timedOut.push(p.id);
        addChange(q, p.id, { penalty: s.config.wrongAnswerPenalty });
        changeScore(s, p, -s.config.wrongAnswerPenalty, at);
      }
    }
    q.endedAt = at;
    const drain = applyPhaseBaseDrain(phase);
    if (drain > 0) {
      for (const p of getAlivePlayers(s.players)) {
        addChange(q, p.id, { drain });
        changeScore(s, p, -drain, at);
      }
    }
    const alive = getAlivePlayers(s.players);
    const critical = alive.filter((p) => dangerRank(p.danger) >= dangerRank("CRITICAL"));
    if (critical.length >= 2 && q.criticalAtStart < 2) {
      emit(s, { type: "MULTIPLE_PLAYERS_CRITICAL", at, playerIds: critical.map((p) => p.id) });
    }
    if (alive.length === 2 && q.aliveAtStart.length > 2) {
      emit(s, { type: "FINAL_TWO", at, playerIds: alive.map((p) => p.id) });
    }
    s.questionsPlayed += 1;
    s.step = "reveal";
    s.stepStartedAt = now;
    s.stepEndsAt = now + s.config.revealMs;
    // The last one standing: no extra wait – only until the last car is under the slime.
    if (!s.solo && alive.length === 1) {
      const lastOut = Math.max(0, ...s.players.map((p) => (p.removed ? 0 : (p.eliminatedAt ?? 0))));
      s.stepEndsAt = Math.min(s.stepEndsAt, Math.max(now + s.config.finalRevealMinMs, lastOut + s.config.eliminationAnimMs));
    }
  }

  /** After the rules: the moderator opens the finale, then the elevators ride up to their start. */
  function startLaunch(s: SurvivalState, now: number) {
    s.step = "launch";
    s.stepStartedAt = now;
    s.stepEndsAt = now + s.config.launchPauseMs + s.config.launchLineMaxMs;
    s.launchRiseAt = null;
    const ids = s.players.filter((p) => !p.removed).map((p) => p.id);
    emit(s, { type: "LAUNCH", at: now, playerIds: ids });
    emit(s, { type: "SCORES_CONVERTED", at: now, playerIds: ids });
  }

  /** The ride starts (the moderator's line is over, or the safety time): never before the pause. */
  function startRise(s: SurvivalState, now: number) {
    const riseAt = Math.max(now, s.stepStartedAt + s.config.launchPauseMs);
    s.launchRiseAt = riseAt;
    s.stepEndsAt = riseAt + s.config.riseMs;
  }

  /** Server tick during a question (alarm or any update). */
  function tick(s: SurvivalState, now: number) {
    const q = s.question;
    if (s.step !== "question" || !q) return;
    settleDecay(s, now);
    if (settled(s, q)) endQuestion(s, Math.min(now, q.timeoutAt), now);
    else if (now >= q.timeoutAt) endQuestion(s, q.timeoutAt, now);
  }

  function nextTick(s: SurvivalState, now: number): number {
    const q = s.question!;
    if (now >= q.timeoutAt || s.config.scoreDecayPerSecond <= 0 || settled(s, q)) return q.timeoutAt;
    if (now < q.decayFrom) return q.decayFrom;
    return Math.min(q.decayFrom + (Math.floor((now - q.decayFrom) / 1000) + 1) * 1000, q.timeoutAt);
  }

  function afterReveal(s: SurvivalState, now: number, ops: Ops) {
    const alive = getAlivePlayers(s.players);
    if (s.solo) {
      if (alive.length === 0) return finish(s, now, null);
      return nextQuestionOrPhase(s, now, ops);
    }
    if (alive.length === 1) return finish(s, now, alive[0]!.id);
    if (alive.length === 0) return startSuddenDeath(s, now, ops);
    return nextQuestionOrPhase(s, now, ops);
  }

  function nextQuestionOrPhase(s: SurvivalState, now: number, ops: Ops) {
    const next = escalate({
      questionsPlayed: s.questionsPlayed,
      currentPhaseIndex: s.phaseIndex,
      aliveCount: getAlivePlayers(s.players).length,
      config: s.config,
    });
    if (next > s.phaseIndex) {
      s.phaseIndex = Math.min(next, s.config.phases.length - 1);
      emit(s, { type: "PHASE_CHANGED", at: now, phase: getCurrentPhase(s.phaseIndex, s.config).id });
      s.step = "phase_change";
      s.stepStartedAt = now;
      s.stepEndsAt = now + s.config.phaseChangeMs;
      return;
    }
    openQuestion(s, now, ops);
  }

  function startSuddenDeath(s: SurvivalState, now: number, ops: Ops) {
    const participants = (s.question?.aliveAtStart ?? []).filter((id) => !find(s, id)?.removed);
    if (participants.length === 0) return finish(s, now, null);
    const decision = suddenDeath.decide({ participants, occurrences: s.suddenDeaths, config: s.config });
    if (decision.kind === "tiebreak") {
      emit(s, { type: "TIEBREAK", at: now, playerIds: decision.playerIds });
      return openTiebreak(s, decision.playerIds, now, 1, ops);
    }
    for (const id of decision.playerIds) {
      const p = find(s, id)!;
      p.score = decision.score;
      p.danger = getDangerLevel(p.score, s.config);
      p.eliminatedAt = null;
      p.eliminatedQuestion = null;
    }
    s.suddenDeaths += 1;
    const phaseChanged = decision.phaseIndex > s.phaseIndex;
    s.phaseIndex = Math.max(s.phaseIndex, decision.phaseIndex);
    emit(s, { type: "SUDDEN_DEATH", at: now, playerIds: decision.playerIds, round: decision.round, score: decision.score });
    if (phaseChanged) emit(s, { type: "PHASE_CHANGED", at: now, phase: getCurrentPhase(s.phaseIndex, s.config).id });
    s.step = "sudden_death";
    s.stepStartedAt = now;
    s.stepEndsAt = now + s.config.suddenDeathMs;
  }

  function openTiebreak(s: SurvivalState, participants: string[], now: number, attempt: number, ops: Ops) {
    const drawn = drawEstimate(pools, s.source);
    s.source = drawn.source;
    if (!drawn.question) return finishByElimination(s, participants, now);
    const endsAt = now + s.config.tiebreakSeconds * 1000;
    s.tiebreak = { attempt, participants, question: drawn.question, startedAt: now, endsAt, answers: {}, result: null };
    s.step = "tiebreak";
    s.stepStartedAt = now;
    s.stepEndsAt = endsAt;
    ops.used.push(drawn.question.id);
  }

  function resolveTiebreakNow(s: SurvivalState, now: number) {
    const tb = s.tiebreak!;
    const participants = tb.participants.filter((id) => !find(s, id)?.removed);
    tb.result = suddenDeath.resolveTiebreak({ participants, answers: tb.answers, correct: tb.question.answer });
    s.step = "tiebreak_reveal";
    s.stepStartedAt = now;
    s.stepEndsAt = now + s.config.tiebreakRevealMs;
  }

  function afterTiebreak(s: SurvivalState, now: number, ops: Ops) {
    const tb = s.tiebreak!;
    const result = tb.result!;
    if (result.winnerId) {
      const losers = result.order.filter((id) => id !== result.winnerId);
      const firstSilent = losers.findIndex((id) => result.unanswered.includes(id));
      losers.forEach((id, i) => {
        find(s, id)!.tiebreakPlace = firstSilent >= 0 && i >= firstSilent ? firstSilent : i;
      });
      return crown(s, result.winnerId, now);
    }
    if (tb.attempt < s.config.maxTiebreakAttempts) return openTiebreak(s, tb.participants, now, tb.attempt + 1, ops);
    finishByElimination(s, tb.participants, now);
  }

  /** The tie-breaker's (or a fallback's) winner comes back out of the slime. */
  function crown(s: SurvivalState, winnerId: string, now: number) {
    const p = find(s, winnerId)!;
    p.eliminatedAt = null;
    p.eliminatedQuestion = null;
    p.tiebreakPlace = null;
    p.score = Math.max(p.score, s.config.suddenDeathScore);
    p.danger = getDangerLevel(p.score, s.config);
    finish(s, now, winnerId);
  }

  /** Nobody answered any tie-breaker: whoever went out last wins (then the higher main-game score – lane order). */
  function finishByElimination(s: SurvivalState, participants: readonly string[], now: number) {
    const order = participants
      .map((id) => find(s, id)!)
      .filter((p) => p && !p.removed)
      .sort((a, b) => (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0) || a.lane - b.lane);
    if (order.length === 0) return finish(s, now, null);
    order.slice(1).forEach((p, i) => (p.tiebreakPlace = i));
    crown(s, order[0]!.id, now);
  }

  /** No question could be drawn at all: the highest score wins (never random). */
  function finishByScore(s: SurvivalState, now: number) {
    const alive = [...getAlivePlayers(s.players)].sort((a, b) => b.score - a.score || a.lane - b.lane);
    const winner = alive[0];
    alive.slice(1).forEach((p, i) => {
      p.eliminatedAt = now;
      p.tiebreakPlace = i;
    });
    finish(s, now, s.solo ? null : (winner?.id ?? null));
  }

  function finish(s: SurvivalState, now: number, winnerId: string | null) {
    s.winnerId = winnerId;
    s.ranking = getFinalRanking(s.players, winnerId);
    if (winnerId) {
      const p = find(s, winnerId)!;
      emit(s, { type: "WINNER", at: now, playerId: winnerId, score: displayScore(p.score) });
    }
    s.step = "winner";
    s.stepStartedAt = now;
    // With a winner the room moves on when the moderator's lines are over (winnerMs is only the safety net).
    s.stepEndsAt = now + (winnerId ? s.config.winnerMs : s.config.noWinnerMs);
  }

  function update(s: SurvivalState, now: number, ops: Ops): ModuleUpdate<SurvivalState> {
    const phaseEndsAt = s.step === "question" && s.question ? nextTick(s, now) : s.stepEndsAt;
    return {
      state: s,
      phaseEndsAt,
      ...(ops.used.length ? { usedContentIds: ops.used } : {}),
      ...(s.ranking ? { ranking: s.ranking } : {}),
    };
  }

  const ops = (ctx: ModuleContext): Ops => ({ used: [], random: ctx.random });

  return {
    meta: survivalMeta,
    actionSchema,

    init(ctx, options) {
      const config = baseConfig;
      const scores = ctx.scores ?? {};
      const ids = ctx.players.map((p) => p.id);
      const start = convertStartScores(scores, ids, config);
      // Lanes left → right by the main game's standings (ties: join order).
      const lanes = ids
        .map((id, i) => ({ id, i, score: scores[id] ?? 0 }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((x) => x.id);
      const s: SurvivalState = {
        config,
        step: "intro",
        stepStartedAt: ctx.now,
        stepEndsAt: ctx.now + config.introMs,
        players: lanes.map((id, lane) => ({
          id,
          lane,
          mainScore: scores[id] ?? 0,
          startScore: start[id]!,
          score: start[id]!,
          danger: getDangerLevel(start[id]!, config),
          eliminatedAt: null,
          eliminatedQuestion: null,
        })),
        phaseIndex: 0,
        questionsPlayed: 0,
        suddenDeaths: 0,
        question: null,
        tiebreak: null,
        winnerId: null,
        solo: ids.length === 1,
        ranking: null,
        events: [],
        eventSeq: 0,
        source: buildQuestionSource(pools, options, ctx.random, survivalMeta, estimateMeta, config),
      };
      if (ids.length === 0) return { state: s, phaseEndsAt: null, done: true };
      emit(s, { type: "FINALE_STARTED", at: ctx.now, playerIds: lanes });
      if (ids.length === 2) emit(s, { type: "FINAL_TWO", at: ctx.now, playerIds: lanes });
      return { state: s, phaseEndsAt: s.stepEndsAt };
    },

    handleAction(state, action, playerId, ctx) {
      const s = structuredClone(state);
      const o = ops(ctx);
      const p = find(s, playerId);
      if (!p || p.removed || !ctx.players.some((cp) => cp.id === playerId)) return { error: "UNKNOWN_PLAYER" };

      if (action.type === "estimate") {
        const tb = s.tiebreak;
        if (s.step !== "tiebreak" || !tb) return { error: "WRONG_PHASE" };
        if (!tb.participants.includes(playerId)) return { error: "ELIMINATED" };
        if (ctx.now > tb.endsAt) return { error: "TOO_LATE" };
        if (playerId in tb.answers) return { error: "ALREADY_ANSWERED" };
        tb.answers[playerId] = { value: action.value, at: ctx.now };
        if (tb.participants.every((id) => id in tb.answers || find(s, id)?.removed)) resolveTiebreakNow(s, ctx.now);
        return update(s, ctx.now, o);
      }

      const q = s.question;
      if (s.step !== "question" || !q) return { error: "WRONG_PHASE" };
      if (ctx.now > q.timeoutAt) return { error: "TOO_LATE" };
      if (playerId in q.answers) return { error: "ALREADY_ANSWERED" };
      // Book the decay up to now first – the player may have hit 0 a moment ago.
      settleDecay(s, ctx.now);
      if (isOut(p) || !q.aliveAtStart.includes(playerId)) return { error: "ELIMINATED" };

      const phase = getCurrentPhase(q.phaseIndex, s.config);
      const responseMs = ctx.now - q.startedAt;
      const correct = action.value === q.question.correctIndex;
      const change = calculateSurvivalScoreChange({ correct, responseMs, phase }, s.config);
      const applied = q.decayApplied[playerId] ?? 0;
      const extraDecay = Math.max(0, change.decay - applied);
      q.decayApplied[playerId] = Math.max(applied, change.decay);
      q.answers[playerId] = { value: action.value, at: ctx.now, correct, responseMs };
      addChange(q, playerId, { bonus: change.bonus, penalty: change.penalty, decay: extraDecay });
      const delta = change.bonus - change.penalty - extraDecay;
      const event = { at: ctx.now, playerId, responseMs, scoreChange: delta, previousScore: displayScore(p.score), score: displayScore(p.score + delta) };
      if (change.bonus > 0) emit(s, { type: "FAST_CORRECT", ...event });
      if (!correct) emit(s, { type: "WRONG_ANSWER", ...event });
      changeScore(s, p, delta, ctx.now);
      if (settled(s, q)) endQuestion(s, ctx.now, ctx.now);
      return update(s, ctx.now, o);
    },

    onTimer(state, ctx) {
      const s = structuredClone(state);
      const o = ops(ctx);
      const now = ctx.now;
      switch (s.step) {
        case "intro":
          startLaunch(s, now);
          break;
        case "launch":
          if (s.launchRiseAt == null) startRise(s, now);
          else openQuestion(s, now, o);
          break;
        case "phase_change":
        case "sudden_death":
          openQuestion(s, now, o);
          break;
        case "question":
          // Ticks book the decay; the host's "Weiter" never cuts a question short.
          tick(s, now);
          break;
        case "reveal":
          afterReveal(s, now, o);
          break;
        case "tiebreak":
          if (now >= s.tiebreak!.endsAt) resolveTiebreakNow(s, now);
          break;
        case "tiebreak_reveal":
          afterTiebreak(s, now, o);
          break;
        case "winner":
          return { state: s, phaseEndsAt: null, done: true, ...(s.ranking ? { ranking: s.ranking } : {}) };
      }
      return update(s, now, o);
    },

    onPlayersChanged(state, ctx) {
      const present = new Set(ctx.players.map((p) => p.id));
      if (state.players.every((p) => p.removed || present.has(p.id))) return null;
      const s = structuredClone(state);
      // Kicked players leave the finale (no slime, no place).
      for (const p of s.players) {
        if (p.removed || present.has(p.id)) continue;
        p.removed = true;
        if (p.eliminatedAt === null) p.eliminatedAt = ctx.now;
      }
      const o = ops(ctx);
      if (s.step === "question") tick(s, ctx.now);
      else if (s.step === "tiebreak" && s.tiebreak) {
        const tb = s.tiebreak;
        if (tb.participants.every((id) => id in tb.answers || find(s, id)?.removed)) resolveTiebreakNow(s, ctx.now);
      }
      return update(s, ctx.now, o);
    },

    progress(s) {
      const index = s.question ? s.question.number - 1 : 0;
      const onQuestion = s.step === "question" || s.step === "reveal";
      return {
        index,
        total: index + 1,
        step: s.step,
        contentId: onQuestion ? s.question?.contentId : undefined,
        revealed: s.step !== "question",
      };
    },

    botAction(s, botId, _ctx, bot) {
      if (s.step === "question" && s.question) {
        const q = s.question;
        const p = find(s, botId);
        if (isOut(p) || !q.aliveAtStart.includes(botId) || botId in q.answers) return null;
        return { type: "answer", value: botChoice(q.question.correctIndex, q.question.options.length, bot) };
      }
      if (s.step === "tiebreak" && s.tiebreak) {
        const tb = s.tiebreak;
        if (!tb.participants.includes(botId) || botId in tb.answers) return null;
        return { type: "estimate", value: botEstimate(tb.question.answer, bot) };
      }
      return null;
    },

    toStats(s, exclude) {
      const q = s.question;
      if (!q || s.step !== "reveal") return null;
      const entries = Object.entries(q.answers).filter(([id]) => !exclude?.has(id));
      if (exclude?.size && entries.length === 0) return null;
      return {
        contentId: q.contentId,
        answers: entries.length,
        correct: entries.filter(([, a]) => a.correct).length,
        sumResponseMs: entries.reduce((sum, [, a]) => sum + Math.max(0, a.responseMs), 0),
        sumErrorPct: null,
      };
    },

    pendingTask(s) {
      return aiQuestionTask(pools, s.source, s.config);
    },

    resolveTask(state, taskId, result, ctx) {
      if (!state.source.ai.pending || taskId !== aiTaskId(state.source)) return null;
      const s = structuredClone(state);
      s.source = addAiQuestions(pools, s.source, result).source;
      return update(s, ctx.now, ops(ctx));
    },

    toPublicState(s, viewer: Viewer): SurvivalPublicState {
      const q = s.question;
      const onQuestion = !!q && (s.step === "question" || s.step === "reveal");
      const me = viewer.role === "player" ? viewer.playerId : null;
      const phase = getCurrentPhase(s.phaseIndex, s.config);
      const players: SurvivalPublicPlayer[] = s.players
        .filter((p) => !p.removed)
        .map((p) => ({
          id: p.id,
          lane: p.lane,
          mainScore: p.mainScore,
          startScore: p.startScore,
          score: displayScore(p.score),
          danger: p.danger,
          eliminated: p.eliminatedAt !== null,
          eliminatedAt: p.eliminatedAt,
          eliminatedQuestion: p.eliminatedQuestion,
          answered: onQuestion ? p.id in q!.answers : false,
          decayApplied: onQuestion ? (q!.decayApplied[p.id] ?? 0) : 0,
          change: onQuestion ? (q!.changes[p.id] ?? null) : null,
        }));
      const tb = s.tiebreak;
      const showTiebreak = !!tb && (s.step === "tiebreak" || s.step === "tiebreak_reveal");
      return {
        step: s.step,
        stepStartedAt: s.stepStartedAt,
        stepEndsAt: s.stepEndsAt,
        phaseIndex: s.phaseIndex,
        phase,
        questionsPlayed: s.questionsPlayed,
        suddenDeaths: s.suddenDeaths,
        players,
        question: onQuestion
          ? {
              number: q!.number,
              text: q!.question.text,
              options: q!.question.options,
              startedAt: q!.startedAt,
              bonusUntil: q!.bonusUntil,
              decayFrom: q!.decayFrom,
              timeoutAt: q!.timeoutAt,
              phase: getCurrentPhase(q!.phaseIndex, s.config),
              aliveAtStart: q!.aliveAtStart,
            }
          : null,
        myAnswer: onQuestion && me ? (q!.answers[me]?.value ?? null) : null,
        reveal:
          onQuestion && s.step === "reveal"
            ? {
                correctIndex: q!.question.correctIndex,
                answers: Object.fromEntries(Object.entries(q!.answers).map(([id, a]) => [id, a.value])),
              }
            : null,
        launch:
          s.step === "intro" || s.step === "launch"
            ? { riseAt: s.step === "launch" ? (s.launchRiseAt ?? null) : null, riseMs: s.config.riseMs }
            : null,
        tiebreak: showTiebreak
          ? {
              attempt: tb!.attempt,
              participants: tb!.participants,
              text: tb!.question.text,
              unit: tb!.question.unit,
              format: tb!.question.format,
              startedAt: tb!.startedAt,
              endsAt: tb!.endsAt,
              answeredPlayerIds: Object.keys(tb!.answers),
              myAnswer: me ? (tb!.answers[me]?.value ?? null) : null,
              reveal:
                s.step === "tiebreak_reveal" && tb!.result
                  ? {
                      answer: tb!.question.answer,
                      answers: Object.fromEntries(Object.entries(tb!.answers).map(([id, a]) => [id, a.value])),
                      order: tb!.result.order,
                      winnerId: tb!.result.winnerId,
                    }
                  : null,
            }
          : null,
        winnerId: s.winnerId,
        solo: s.solo,
        ranking: s.ranking,
        events: s.events,
        rules: {
          wrongAnswerPenalty: s.config.wrongAnswerPenalty,
          scoreDecayPerSecond: s.config.scoreDecayPerSecond,
          moderatorCaptions: s.config.moderatorCaptions,
          danger: s.config.danger,
        },
      };
    },
  };
}

export const survivalModule = createSurvivalModule();

/**
 * The finale waits for the moderator: when his opening line ends the ride
 * starts, when his last line ends the ceremony follows. Returns the moment
 * the room should move on (its timer), or null when the cue doesn't apply
 * (wrong step, already moving). The step's own safety time still holds.
 */
export type SurvivalCue = "launch" | "ceremony";

export function survivalCueAt(s: SurvivalState, cue: SurvivalCue, now: number): number | null {
  if (cue === "launch") return s.step === "launch" && s.launchRiseAt == null ? now : null;
  if (s.step !== "winner" || !s.winnerId) return null;
  // Without any line the platform still rides up and the winner cheers a moment.
  return Math.max(now, s.stepStartedAt + s.config.winnerMinMs);
}
