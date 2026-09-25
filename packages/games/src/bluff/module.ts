/**
 * Bluff-Lexikon: a rare real word, everyone invents a definition, then all
 * invented ones plus the real one are shown as A, B, C, … and everyone bets
 * on the real one. Points for finding the truth AND for fooling others.
 *
 * The AI check (correct definitions, merging, typos, offensive texts) is a
 * generic module task the room runs; without an answer in 5 s everything is
 * shown as written.
 */
import { BLUFF_WORDS_DE, BluffWordSchema, type BluffWord } from "@couch-clash/content";
import {
  REVEAL_LEADERBOARD_MS,
  type ContentEntry,
  type GameModule,
  type ModuleContext,
  type ModuleUpdate,
  type RevealFacts,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { listEntries, parseWith, playablePool } from "../content-pool";
import { pickFresh, shuffle } from "../random";
import { normalizeScoring, scoreAnswer } from "../scoring";
import {
  judgePrompt,
  lightCleanup,
  localMatch,
  normalizeText,
  parseJudgeReply,
  type JudgeSubmission,
  type JudgedSubmission,
} from "./judge";
import { bluffLead, bluffQuestion } from "./text";
import { BLUFF_CONFIG, OPTION_LETTERS, bluffMeta } from "./meta";
import type { BluffAction, BluffPublicState, BluffResult, BluffRevealOption, BluffStep } from "./types";

interface Option {
  text: string;
  correct: boolean;
  authors: string[];
}

export interface BluffState {
  words: BluffWord[];
  index: number;
  step: BluffStep;
  stepStartedAt: number;
  stepEndsAt: number;
  submissions: Record<string, { text: string; at: number }>;
  /** Wrote an essentially correct definition. */
  knewIt: string[];
  /** Offensive submissions (not shown, no fooling points). */
  rejected: string[];
  /** Shuffled options from "present" on. */
  options: Option[] | null;
  votes: Record<string, { option: number; at: number }>;
  results: Record<string, BluffResult> | null;
  scoring: ScoringSettings;
  /** Polished text per author (what everyone sees; the raw text only in `submissions`). */
  shown: Record<string, string>;
  /** Host option: show the authors' original texts at the reveal. */
  showOriginals: boolean;
}

const WRITE_MS = bluffMeta.secondsPerQuestion * 1000;
const VOTE_MS = BLUFF_CONFIG.voteSeconds * 1000;

/** Single line, no control characters, max 80 characters. */
export function cleanDefinition(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BLUFF_CONFIG.maxDefinitionLength)
    .trim();
}

/** Same look for every option (no giveaway): capital first letter, no final full stop. */
export function displayDefinition(text: string): string {
  const t = text.replace(/[.\s]+$/u, "");
  return t.charAt(0).toLocaleUpperCase("de") + t.slice(1);
}

/** For comparing texts: lower case, letters and digits only. */
export const normalizeDefinition = normalizeText;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("define"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("vote"), option: z.number().int().min(0).max(OPTION_LETTERS.length - 1) }),
]) as z.ZodType<BluffAction>;

const entry = (w: BluffWord): ContentEntry => ({
  id: w.id,
  text: `${w.article} ${w.word}`,
  answer: w.definition,
  difficulty: w.difficulty,
  ageRating: w.ageRating,
  tags: w.tags,
  payload: w,
});

const REVEALED_STEPS: readonly BluffStep[] = ["reveal", "solution", "leaderboard"];

export function createBluffModule(pool: readonly BluffWord[] = BLUFF_WORDS_DE) {
  type State = BluffState;
  const at = (state: State, step: BluffStep, now: number, ms: number): State => ({
    ...state,
    step,
    stepStartedAt: now,
    stepEndsAt: now + ms,
  });
  const update = (state: State, extra: Partial<ModuleUpdate<State>> = {}): ModuleUpdate<State> => ({
    state,
    phaseEndsAt: state.stepEndsAt,
    ...extra,
  });

  function openWord(state: State, index: number, now: number): ModuleUpdate<State> {
    return update(
      at(
        { ...state, index, submissions: {}, shown: {}, knewIt: [], rejected: [], options: null, votes: {}, results: null },
        "write",
        now,
        WRITE_MS,
      ),
    );
  }

  /** Stable order and anonymous keys for the AI check. */
  function judgeSubmissions(state: State): (JudgeSubmission & { playerId: string })[] {
    return Object.entries(state.submissions)
      .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))
      .map(([playerId, s], i) => ({ key: `s${i + 1}`, text: s.text, playerId }));
  }

  /** Writing is over: check (AI) – or straight to the options when nobody wrote anything. */
  function endWriting(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    if (Object.keys(state.submissions).length === 0) return present(state, null, ctx);
    return update(at(state, "check", ctx.now, BLUFF_CONFIG.checkMaxMs));
  }

  /**
   * Builds the options – with the AI verdicts and polished texts, or (judge
   * failed) with a local check and cleanup – and starts reading them out.
   * Options only ever contain polished texts, never the raw player text.
   */
  function present(state: State, judged: Map<string, JudgedSubmission> | null, ctx: ModuleContext): ModuleUpdate<State> {
    const word = state.words[state.index]!;
    const real = normalizeText(word.definition);
    const knewIt: string[] = [];
    const rejected: string[] = [];
    const shown: Record<string, string> = {};
    const groups = new Map<string, Option>();
    for (const s of judgeSubmissions(state)) {
      const verdict = judged?.get(s.key);
      const text = displayDefinition(verdict?.text ?? (lightCleanup(s.text) || s.text));
      shown[s.playerId] = text;
      const correct = verdict ? verdict.verdict === "correct" : localMatch(s.text, word.definition);
      // Never show a player text that duplicates the real answer.
      if (correct || normalizeText(text) === real) {
        knewIt.push(s.playerId);
        continue;
      }
      if (verdict?.verdict === "offensive") {
        rejected.push(s.playerId);
        continue;
      }
      // Without the AI: only identical (cleaned) texts are merged.
      const key = verdict ? verdict.group : `text:${normalizeText(text)}`;
      const group = groups.get(key);
      if (group) group.authors.push(s.playerId);
      else groups.set(key, { text, correct: false, authors: [s.playerId] });
    }
    const realOption = { text: displayDefinition(word.definition), correct: true, authors: [] };
    const options = shuffle([...groups.values(), realOption], ctx.random);
    const ms = BLUFF_CONFIG.presentLeadMs + options.length * BLUFF_CONFIG.presentMsPerOption;
    return update(at({ ...state, knewIt, rejected, options, shown }, "present", ctx.now, ms));
  }

  function canVote(state: State, playerId: string): boolean {
    if (state.knewIt.includes(playerId) || !state.options) return false;
    return state.options.some((o) => !o.authors.includes(playerId));
  }

  /** Connected players who may vote. */
  function voters(state: State, ctx: ModuleContext) {
    return ctx.players.filter((p) => p.connected && canVote(state, p.id));
  }

  function afterPresent(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    const playerOptions = state.options?.filter((o) => !o.correct).length ?? 0;
    // Only the real definition, or nobody who could vote → no voting.
    if (playerOptions === 0 || voters(state, ctx).length === 0) return reveal(state, ctx.now);
    return update(at(state, "vote", ctx.now, VOTE_MS));
  }

  function allVoted(state: State, ctx: ModuleContext) {
    const eligible = voters(state, ctx);
    return eligible.length > 0 && eligible.every((p) => p.id in state.votes);
  }

  function score(state: State): Record<string, BluffResult> {
    const options = state.options ?? [];
    const scoring = normalizeScoring(bluffMeta, state.scoring);
    const participants = new Set([...Object.keys(state.submissions), ...Object.keys(state.votes), ...state.knewIt]);
    const results: Record<string, BluffResult> = {};
    for (const id of participants) {
      const vote = state.votes[id];
      const votedCorrect = vote !== undefined && !!options[vote.option]?.correct;
      const knewIt = state.knewIt.includes(id);
      const fooled = Object.entries(state.votes).filter(
        ([voter, v]) => voter !== id && options[v.option]?.authors.includes(id),
      ).length;
      const r = scoreAnswer(
        scoring,
        { votedCorrect, knewIt, fooled, perFooledShare: BLUFF_CONFIG.perFooledShare, knewItShare: BLUFF_CONFIG.knewItShare },
        { responseTimeMs: 0, timeLimitMs: 1 },
      );
      results[id] = { ...r, votedCorrect, knewIt, fooled };
    }
    return results;
  }

  function reveal(state: State, now: number): ModuleUpdate<State> {
    const results = score(state);
    const scoreDelta: Record<string, number> = {};
    for (const [id, r] of Object.entries(results)) if (r.finalScore > 0) scoreDelta[id] = r.finalScore;
    const fakes = state.options?.filter((o) => !o.correct).length ?? 0;
    const ms = Math.min(BLUFF_CONFIG.revealMaxMs, BLUFF_CONFIG.revealBaseMs + fakes * BLUFF_CONFIG.revealMsPerOption);
    return update(at({ ...state, results }, "reveal", now, ms), { scoreDelta });
  }

  function checkTask(state: State) {
    const word = state.words[state.index]!;
    return {
      id: `bluff-check:${state.index}`,
      kind: "llm_json" as const,
      input: judgePrompt(`${word.article} ${word.word}`, word.definition, judgeSubmissions(state)),
      timeoutMs: BLUFF_CONFIG.checkTimeoutMs,
      model: "strong" as const,
    };
  }

  const module: GameModule<State, BluffAction, BluffPublicState> = {
    meta: bluffMeta,
    actionSchema,

    init(ctx, options) {
      const words = pickFresh(playablePool(pool, BluffWordSchema, options), options.questionCount, options.excludeContentIds, ctx.random);
      const initial: State = {
        words,
        index: 0,
        step: "write",
        stepStartedAt: ctx.now,
        stepEndsAt: ctx.now,
        submissions: {},
        knewIt: [],
        rejected: [],
        options: null,
        votes: {},
        results: null,
        scoring: normalizeScoring(bluffMeta, options.scoring),
        shown: {},
        showOriginals: options.options?.showOriginals === true,
      };
      if (words.length === 0) return { state: initial, phaseEndsAt: null, done: true };
      return { ...openWord(initial, 0, ctx.now), usedContentIds: words.map((w) => w.id) };
    },

    handleAction(state, action, playerId, ctx) {
      if (!ctx.players.some((p) => p.id === playerId)) return { error: "UNKNOWN_PLAYER" };
      if (action.type === "define") {
        if (state.step !== "write") return { error: "WRONG_PHASE" };
        if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
        if (playerId in state.submissions) return { error: "ALREADY_ANSWERED" };
        const text = cleanDefinition(action.text);
        if (!text) return { error: "INVALID_MESSAGE" };
        const next: State = { ...state, submissions: { ...state.submissions, [playerId]: { text, at: ctx.now } } };
        const connected = ctx.players.filter((p) => p.connected);
        if (connected.length > 0 && connected.every((p) => p.id in next.submissions)) return endWriting(next, ctx);
        return update(next);
      }
      if (state.step !== "vote") return { error: "WRONG_PHASE" };
      if (ctx.now > state.stepEndsAt) return { error: "TOO_LATE" };
      if (playerId in state.votes) return { error: "ALREADY_ANSWERED" };
      if (state.knewIt.includes(playerId)) return { error: "WRONG_PHASE" };
      const option = state.options?.[action.option];
      if (!option) return { error: "INVALID_MESSAGE" };
      if (option.authors.includes(playerId)) return { error: "OWN_ANSWER" };
      const next: State = { ...state, votes: { ...state.votes, [playerId]: { option: action.option, at: ctx.now } } };
      if (allVoted(next, ctx)) return reveal(next, ctx.now);
      return update(next);
    },

    onTimer(state, ctx) {
      switch (state.step) {
        case "write":
          return endWriting(state, ctx);
        case "check":
          // The AI answer did not arrive in time: show everything as written.
          return present(state, null, ctx);
        case "present":
          return afterPresent(state, ctx);
        case "vote":
          return reveal(state, ctx.now);
        case "reveal":
          return update(at(state, "solution", ctx.now, BLUFF_CONFIG.solutionMs));
        case "solution":
          return update(at(state, "leaderboard", ctx.now, REVEAL_LEADERBOARD_MS));
        case "leaderboard": {
          const nextIndex = state.index + 1;
          if (nextIndex < state.words.length) return openWord(state, nextIndex, ctx.now);
          return { state, phaseEndsAt: null, done: true };
        }
      }
    },

    onPlayersChanged(state, ctx) {
      if (state.step === "write") {
        const connected = ctx.players.filter((p) => p.connected);
        if (connected.length > 0 && Object.keys(state.submissions).length > 0 && connected.every((p) => p.id in state.submissions)) {
          return endWriting(state, ctx);
        }
      }
      if (state.step === "vote" && allVoted(state, ctx)) return reveal(state, ctx.now);
      return null;
    },

    pendingTask(state) {
      return state.step === "check" ? checkTask(state) : null;
    },

    resolveTask(state, taskId, result, ctx) {
      if (state.step !== "check" || taskId !== checkTask(state).id) return null;
      const judged = result == null ? null : parseJudgeReply(result, judgeSubmissions(state));
      return present(state, judged, ctx);
    },

    readAloud(state) {
      if (state.step !== "present" || !state.options) return null;
      const single = state.options.length === 1;
      return {
        key: `present:${state.index}`,
        items: state.options.map((o, i) => ({
          cue: `option:${i}`,
          text: single ? `Die Erklärung lautet: ${o.text}` : `${OPTION_LETTERS[i]}: ${o.text}`,
        })),
      };
    },

    progress(state) {
      return {
        index: state.index,
        total: state.words.length,
        step: state.step,
        contentId: state.words[state.index]?.id,
        revealed: REVEALED_STEPS.includes(state.step),
      };
    },

    toStats(state) {
      if (!REVEALED_STEPS.includes(state.step) || !state.results || !state.options) return null;
      const votes = Object.values(state.votes);
      const fooledVotes = votes.filter((v) => !state.options![v.option]?.correct).length;
      return {
        contentId: state.words[state.index]!.id,
        answers: votes.length,
        correct: votes.length - fooledVotes,
        sumResponseMs: votes.reduce((sum, v) => sum + Math.max(0, v.at - state.stepStartedAt), 0),
        sumErrorPct: null,
        extra: { submissions: Object.keys(state.submissions).length, knewIt: state.knewIt.length, fooledVotes },
      };
    },

    revealFacts(state) {
      if (!REVEALED_STEPS.includes(state.step) || !state.results) return null;
      const word = state.words[state.index]!;
      const answers: RevealFacts["answers"] = {};
      for (const [id, r] of Object.entries(state.results)) {
        const own = state.shown[id];
        const note = r.knewIt
          ? "wusste die echte Bedeutung"
          : r.fooled > 0
            ? `hat ${r.fooled} Mitspieler mit der erfundenen Erklärung reingelegt`
            : r.votedCorrect
              ? "hat die echte Erklärung gefunden"
              : id in state.votes
                ? "ist auf eine erfundene Erklärung reingefallen"
                : undefined;
        answers[id] = {
          text: own ?? "(keine Erklärung)",
          correct: r.votedCorrect || r.knewIt,
          accuracy: r.votedCorrect || r.knewIt ? 1 : 0,
          points: r.finalScore,
          responseMs: Math.max(0, (state.votes[id]?.at ?? state.stepStartedAt) - state.stepStartedAt),
          ...(note ? { note } : {}),
        };
      }
      return {
        question: bluffQuestion(word),
        correctAnswer: word.definition,
        answers,
        highlights: [
          "Bluff-Runde: Alle haben Erklärungen erfunden und auf die echte getippt. Lob oder necke den besten Bluffer (wer die meisten reingelegt hat) oder wer auf einen Bluff reingefallen ist.",
        ],
      };
    },

    toPublicState(state, viewer: Viewer) {
      const word = state.words[state.index]!;
      const me = viewer.role === "player" ? viewer.playerId : null;
      const revealed = REVEALED_STEPS.includes(state.step) && !!state.options;
      const options = state.options;
      let reveal: BluffPublicState["reveal"] = null;
      if (revealed && options) {
        const revealOptions: BluffRevealOption[] = options.map((o, i) => ({
          text: o.text,
          correct: o.correct,
          authors: o.authors,
          voters: Object.entries(state.votes)
            .filter(([, v]) => v.option === i)
            .map(([id]) => id),
        }));
        reveal = {
          options: revealOptions,
          correctIndex: options.findIndex((o) => o.correct),
          definition: displayDefinition(word.definition),
          lead: bluffLead(word),
          knewItPlayerIds: state.knewIt,
          results: state.results ?? {},
          // Host option (default off): what the authors really wrote.
          originals: state.showOriginals
            ? Object.fromEntries(
                options.flatMap((o) => o.authors).flatMap((id) => (state.submissions[id] ? [[id, state.submissions[id]!.text]] : [])),
              )
            : null,
        };
      }
      return {
        step: state.step,
        index: state.index,
        total: state.words.length,
        word: word.word,
        question: bluffQuestion(word),
        stepStartedAt: state.stepStartedAt,
        stepEndsAt: state.stepEndsAt,
        submittedPlayerIds: Object.keys(state.submissions),
        mySubmission: me ? (state.submissions[me]?.text ?? null) : null,
        iKnewIt: !!me && state.knewIt.includes(me),
        options: options ? options.map((o) => ({ text: o.text })) : null,
        myOptions: me && options ? options.flatMap((o, i) => (o.authors.includes(me) ? [i] : [])) : [],
        canVote: !!me && canVote(state, me),
        votedPlayerIds: Object.keys(state.votes),
        myVote: me ? (state.votes[me]?.option ?? null) : null,
        maxPoints: normalizeScoring(bluffMeta, state.scoring).maxPoints,
        presentLeadMs: BLUFF_CONFIG.presentLeadMs,
        presentMsPerOption: BLUFF_CONFIG.presentMsPerOption,
        reveal,
      };
    },

    listContent: (extra?: readonly unknown[]) => listEntries(pool, BluffWordSchema, extra, entry),
    parseContent: (raw: unknown) => parseWith(BluffWordSchema, raw),
  };
  return module;
}

export const bluffModule = createBluffModule();
