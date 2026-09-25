/**
 * The bluff engine: something real is shown (a rare word, the start of a
 * true story), everyone invents an answer, then all invented ones plus the
 * real one are shown as A, B, C, … and everyone bets on the real one.
 * Points for finding the truth, for knowing it AND for fooling others.
 *
 * The engine knows nothing about the content – a small adapter per game
 * (Bluff-Lexikon, Skurrile Ereignisse) says what to show, what the real
 * answer is and how the AI judges and polishes.
 *
 * The AI check (correct answers, merging, typos, offensive texts) is a
 * generic module task the room runs; without an answer in time everything
 * is shown as written (local check and cleanup).
 */
import {
  botPick,
  DEFAULT_PER_QUESTION_CAP,
  type CategoryMeta,
  type ContentEntry,
  type GameMode,
  type GameModule,
  type ModuleContext,
  type ModuleInitOptions,
  type ModuleUpdate,
  type ReadAloud,
  type RevealFacts,
  REVEAL_LEADERBOARD_MS,
  type ScoringSettings,
  type Viewer,
} from "@couch-clash/shared";
import { z } from "zod";
import { listEntries, parseWith } from "../content-pool";
import { isPartyItem } from "../party-share";
import { shuffle } from "../random";
import { normalizeScoring, scoreAnswer } from "../scoring";
import {
  buildJudgePrompt,
  lightCleanup,
  localMatch,
  normalizeText,
  parseDecoys,
  parseJudgeReply,
  type JudgeStyle,
  type JudgeSubmission,
  type JudgedSubmission,
} from "./judge";
import { BLUFF_CONFIG, OPTION_LETTERS } from "./meta";
import type {
  BluffAction,
  BluffPublicState,
  BluffResult,
  BluffRevealExtra,
  BluffRevealOption,
  BluffStep,
  BluffStory,
} from "./types";

/** What every item needs (mode filter, difficulty weighting, party mix). */
export interface BluffItem {
  id: string;
  difficulty: number;
  ageRating: number;
  adult?: boolean;
}

/** Texts the engine uses for the host's commentary and read-outs. */
export interface BluffEngineTexts {
  /** Read out when there is only the real option ("Die Erklärung lautet: …"). */
  singleOption: string;
  /** Notes about a player for the host's commentary. */
  knewIt: string;
  fooled: (n: number) => string;
  found: string;
  fellFor: string;
  /** A player who wrote nothing. */
  noAnswer: string;
  /** What happened in this round – the host's hint for the commentary. */
  highlight: string;
}

/** One game on the bluff engine: its content and how it is shown and judged. */
export interface BluffContentAdapter<Item extends BluffItem> {
  meta: CategoryMeta;
  /** Static content and its schema (extra content is validated with it). */
  pool: readonly Item[];
  schema: z.ZodType<Item>;
  /** The items of a round: mode filter (Kids / Familie / Party) and party mix. */
  loadItems(pool: readonly Item[], options: ModuleInitOptions, random: () => number): Item[];
  /** Short title (the word; the question for stories). */
  title(item: Item): string;
  /** What TV, phone and voice show as the question ("Ein Borborygmus ist …?"). */
  promptText(item: Item): string;
  /** The start of a true story shown above the question (stories only). */
  story?(item: Item): BluffStory;
  /** Read out by the host when the writing starts (static text), or nothing. */
  readPrompt?(item: Item): string | null;
  /** The real answer (Lexikon: the definition). */
  realAnswer(item: Item): string;
  /** Before the real answer at the reveal ("Ein Borborygmus ist:", "Die Wahrheit:"). */
  revealLead(item: Item): string;
  /** Extra facts at the reveal (stories: fact + source domain). */
  revealExtra?(item: Item): BluffRevealExtra;
  /** What the judge model gets about the item (the submissions are added). */
  judgeContext(item: Item): Record<string, string>;
  /** Comparing and polishing rules for the judge. */
  polishStyle: JudgeStyle;
  /** Phone input placeholder. */
  placeholder: string;
  /** Prefix of the AI check task id. */
  taskPrefix: string;
  texts: BluffEngineTexts;
  /** Test bots: silly answers they "write". */
  botTexts: readonly string[];
  /** Admin catalog entry. */
  toEntry(item: Item): ContentEntry;
}

interface Option {
  text: string;
  correct: boolean;
  authors: string[];
  /** AI decoy ("KI-Lügen ergänzen"): no author, no fool points, 0 for whoever picks it. */
  decoy?: boolean;
}

export interface BluffEngineState<Item> {
  /** The round's items (named "words" since the Bluff-Lexikon – stored rooms keep working). */
  words: Item[];
  index: number;
  step: BluffStep;
  stepStartedAt: number;
  stepEndsAt: number;
  submissions: Record<string, { text: string; at: number }>;
  /** Wrote an essentially correct answer. */
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
  /** Game mode (the judge's "offensive" rule depends on it). */
  mode: GameMode;
  /** Host option "KI-Lügen ergänzen": top up to BLUFF_CONFIG.minWrongOptions with AI decoys. Missing in older rooms. */
  aiDecoys?: boolean;
}

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

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("define"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("vote"), option: z.number().int().min(0).max(OPTION_LETTERS.length - 1) }),
]) as z.ZodType<BluffAction>;

const REVEALED_STEPS: readonly BluffStep[] = ["reveal", "solution", "leaderboard"];

export function createBluffEngine<Item extends BluffItem>(adapter: BluffContentAdapter<Item>, pool: readonly Item[] = adapter.pool) {
  type State = BluffEngineState<Item>;
  const { meta, texts } = adapter;
  const writeMs = meta.secondsPerQuestion * 1000;

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

  function openItem(state: State, index: number, now: number): ModuleUpdate<State> {
    return update(
      at(
        { ...state, index, submissions: {}, shown: {}, knewIt: [], rejected: [], options: null, votes: {}, results: null },
        "write",
        now,
        writeMs,
      ),
    );
  }

  /** Stable order and anonymous keys for the AI check. */
  function judgeSubmissions(state: State): (JudgeSubmission & { playerId: string })[] {
    return Object.entries(state.submissions)
      .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))
      .map(([playerId, s], i) => ({ key: `s${i + 1}`, text: s.text, playerId }));
  }

  /** Decoys to ask the AI check for: few submissions and the host option on. */
  function decoysWanted(state: State): number {
    const few = Object.keys(state.submissions).length < BLUFF_CONFIG.decoysBelowSubmissions;
    return state.aiDecoys && few ? BLUFF_CONFIG.minWrongOptions : 0;
  }

  /** Writing is over: check (AI) – or straight to the options when there is nothing to check or invent. */
  function endWriting(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    if (Object.keys(state.submissions).length === 0 && decoysWanted(state) === 0) return present(state, null, ctx);
    return update(at(state, "check", ctx.now, BLUFF_CONFIG.checkMaxMs));
  }

  /**
   * Builds the options – with the AI verdicts and polished texts, or (judge
   * failed) with a local check and cleanup – and starts reading them out.
   * Options only ever contain polished texts, never the raw player text.
   */
  function present(
    state: State,
    judged: Map<string, JudgedSubmission> | null,
    ctx: ModuleContext,
    decoys: readonly string[] = [],
  ): ModuleUpdate<State> {
    const answer = adapter.realAnswer(state.words[state.index]!);
    const real = normalizeText(answer);
    const knewIt: string[] = [];
    const rejected: string[] = [];
    const shown: Record<string, string> = {};
    const groups = new Map<string, Option>();
    for (const s of judgeSubmissions(state)) {
      const verdict = judged?.get(s.key);
      const text = displayDefinition(verdict?.text ?? (lightCleanup(s.text) || s.text));
      shown[s.playerId] = text;
      const correct = verdict ? verdict.verdict === "correct" : localMatch(s.text, answer);
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
    const realOption = { text: displayDefinition(answer), correct: true, authors: [] };
    // Too few player bluffs: the host's invented ones fill up (never duplicates of the players' texts).
    const bluffs = [...groups.values()];
    const need = state.aiDecoys ? Math.max(0, BLUFF_CONFIG.minWrongOptions - bluffs.length) : 0;
    const taken = new Set([real, ...bluffs.map((o) => normalizeText(o.text))]);
    const fill: Option[] = [];
    for (const d of decoys) {
      if (fill.length >= need) break;
      const text = displayDefinition(d);
      if (taken.has(normalizeText(text))) continue;
      taken.add(normalizeText(text));
      fill.push({ text, correct: false, authors: [], decoy: true });
    }
    const options = shuffle([...bluffs, ...fill, realOption], ctx.random);
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

  function voterIds(state: State, ctx: ModuleContext): string[] {
    return voters(state, ctx).map((p) => p.id);
  }

  function afterPresent(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    const playerOptions = state.options?.filter((o) => !o.correct).length ?? 0;
    // Only the real answer, or nobody who could vote → no voting.
    if (playerOptions === 0 || voters(state, ctx).length === 0) return reveal(state, ctx);
    return update(at(state, "vote", ctx.now, VOTE_MS));
  }

  function allVoted(state: State, ctx: ModuleContext) {
    const eligible = voters(state, ctx);
    return eligible.length > 0 && eligible.every((p) => p.id in state.votes);
  }

  function pointSettings(state: State) {
    const scoring = normalizeScoring(meta, state.scoring);
    const p = scoring.points ?? {};
    return {
      scoring,
      points: { find: p.find ?? 100, know: p.know ?? 100, fool: p.fool ?? 100 },
      cap: scoring.perQuestionCap ?? DEFAULT_PER_QUESTION_CAP,
    };
  }

  /**
   * Scaled bluff scoring: the fooling bonus is the SHARE of players fooled,
   * so it doesn't grow with the number of players; capped per question.
   */
  function score(state: State, ctx: ModuleContext): Record<string, BluffResult> {
    const options = state.options ?? [];
    const { scoring, points } = pointSettings(state);
    // Everyone allowed to vote in this round (connected, not knowers) – plus whoever voted.
    const voters = new Set([...voterIds(state, ctx), ...Object.keys(state.votes)]);
    const realIndex = options.findIndex((o) => o.correct);
    const realPickers = Object.values(state.votes).filter((v) => v.option === realIndex).length;
    const participants = new Set([...Object.keys(state.submissions), ...Object.keys(state.votes), ...state.knewIt]);
    const results: Record<string, BluffResult> = {};
    for (const id of participants) {
      const vote = state.votes[id];
      const found = vote !== undefined && vote.option === realIndex;
      const knew = state.knewIt.includes(id);
      const pickers = Object.entries(state.votes).filter(([voter, v]) => voter !== id && options[v.option]?.authors.includes(id)).length;
      const eligibleVoters = [...voters].filter((v) => v !== id).length;
      const input = { found, knew, pickers, realPickers, eligibleVoters, points };
      const r = scoreAnswer(scoring, input, { responseTimeMs: 0, timeLimitMs: 1 });
      const share = (n: number) => (eligibleVoters > 0 ? Math.min(n, eligibleVoters) / eligibleVoters : 0);
      results[id] = {
        ...r,
        votedCorrect: found,
        knewIt: knew,
        fooled: pickers,
        eligibleVoters,
        realPickers: knew ? realPickers : 0,
        findPoints: found ? points.find : 0,
        foolBonus: Math.round(points.fool * share(pickers)),
        knowPoints: knew ? points.know : 0,
        knowBonus: knew ? Math.round(points.fool * share(realPickers)) : 0,
      };
    }
    return results;
  }

  function reveal(state: State, ctx: ModuleContext): ModuleUpdate<State> {
    const now = ctx.now;
    const results = score(state, ctx);
    const scoreDelta: Record<string, number> = {};
    for (const [id, r] of Object.entries(results)) if (r.finalScore > 0) scoreDelta[id] = r.finalScore;
    const fakes = state.options?.filter((o) => !o.correct).length ?? 0;
    const ms = Math.min(BLUFF_CONFIG.revealMaxMs, BLUFF_CONFIG.revealBaseMs + fakes * BLUFF_CONFIG.revealMsPerOption);
    return update(at({ ...state, results }, "reveal", now, ms), { scoreDelta });
  }

  function checkTask(state: State) {
    const item = state.words[state.index]!;
    return {
      id: `${adapter.taskPrefix}:${state.index}`,
      kind: "llm_json" as const,
      input: buildJudgePrompt(adapter.polishStyle, adapter.judgeContext(item), judgeSubmissions(state), state.mode, decoysWanted(state)),
      timeoutMs: BLUFF_CONFIG.checkTimeoutMs,
      model: "strong" as const,
    };
  }

  const module: GameModule<State, BluffAction, BluffPublicState> = {
    meta,
    actionSchema,

    init(ctx, options) {
      const words = adapter.loadItems(pool, options, ctx.random);
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
        scoring: normalizeScoring(meta, options.scoring),
        shown: {},
        showOriginals: options.options?.showOriginals === true,
        mode: options.mode?.mode ?? "family",
        aiDecoys: options.options?.aiDecoys !== false,
      };
      if (words.length === 0) return { state: initial, phaseEndsAt: null, done: true };
      return { ...openItem(initial, 0, ctx.now), usedContentIds: words.map((w) => w.id) };
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
      if (allVoted(next, ctx)) return reveal(next, ctx);
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
          return reveal(state, ctx);
        case "reveal":
          return update(at(state, "solution", ctx.now, BLUFF_CONFIG.solutionMs));
        case "solution":
          return update(at(state, "leaderboard", ctx.now, REVEAL_LEADERBOARD_MS));
        case "leaderboard": {
          const nextIndex = state.index + 1;
          if (nextIndex < state.words.length) return openItem(state, nextIndex, ctx.now);
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
      if (state.step === "vote" && allVoted(state, ctx)) return reveal(state, ctx);
      return null;
    },

    pendingTask(state) {
      return state.step === "check" ? checkTask(state) : null;
    },

    resolveTask(state, taskId, result, ctx) {
      if (state.step !== "check" || taskId !== checkTask(state).id) return null;
      const judged = result == null ? null : parseJudgeReply(result, judgeSubmissions(state));
      // Decoys are validated on their own: a broken verdict list doesn't cost the decoys (and vice versa).
      const decoys = decoysWanted(state) > 0 ? parseDecoys(result, adapter.realAnswer(state.words[state.index]!)) : [];
      return present(state, judged, ctx, decoys);
    },

    readAloud(state): ReadAloud | null {
      if (state.step === "write") {
        const text = adapter.readPrompt?.(state.words[state.index]!);
        return text ? { key: `prompt:${state.index}`, items: [{ cue: "prompt", text }] } : null;
      }
      if (state.step !== "present" || !state.options) return null;
      const single = state.options.length === 1;
      return {
        key: `present:${state.index}`,
        items: state.options.map((o, i) => ({
          cue: `option:${i}`,
          text: single ? `${texts.singleOption}: ${o.text}` : `${OPTION_LETTERS[i]}: ${o.text}`,
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

    botAction(state, botId, _ctx, bot) {
      if (state.step === "write") {
        if (botId in state.submissions) return null;
        const text = botPick(adapter.botTexts, bot.random);
        return text ? { type: "define", text } : null;
      }
      if (state.step !== "vote" || botId in state.votes || !canVote(state, botId) || !state.options) return null;
      const choices = state.options.flatMap((o, i) => (o.authors.includes(botId) ? [] : [i]));
      const option = botPick(choices, bot.random);
      return option === undefined ? null : { type: "vote", option };
    },

    toStats(state, exclude) {
      if (!REVEALED_STEPS.includes(state.step) || !state.results || !state.options) return null;
      const votes = Object.entries(state.votes)
        .filter(([id]) => !exclude?.has(id))
        .map(([, v]) => v);
      const submissions = Object.keys(state.submissions).filter((id) => !exclude?.has(id)).length;
      if (exclude?.size && votes.length === 0 && submissions === 0) return null;
      const fooledVotes = votes.filter((v) => !state.options![v.option]?.correct).length;
      return {
        contentId: state.words[state.index]!.id,
        answers: votes.length,
        correct: votes.length - fooledVotes,
        sumResponseMs: votes.reduce((sum, v) => sum + Math.max(0, v.at - state.stepStartedAt), 0),
        sumErrorPct: null,
        extra: { submissions, knewIt: state.knewIt.filter((id) => !exclude?.has(id)).length, fooledVotes },
      };
    },

    revealFacts(state) {
      if (!REVEALED_STEPS.includes(state.step) || !state.results) return null;
      const item = state.words[state.index]!;
      const answers: RevealFacts["answers"] = {};
      for (const [id, r] of Object.entries(state.results)) {
        const own = state.shown[id];
        const note = r.knewIt
          ? texts.knewIt
          : r.fooled > 0
            ? texts.fooled(r.fooled)
            : r.votedCorrect
              ? texts.found
              : id in state.votes
                ? texts.fellFor
                : undefined;
        answers[id] = {
          text: own ?? texts.noAnswer,
          correct: r.votedCorrect || r.knewIt,
          accuracy: r.votedCorrect || r.knewIt ? 1 : 0,
          points: r.finalScore,
          responseMs: Math.max(0, (state.votes[id]?.at ?? state.stepStartedAt) - state.stepStartedAt),
          ...(note ? { note } : {}),
        };
      }
      const story = adapter.story?.(item);
      return {
        question: story ? `${story.context} ${adapter.promptText(item)}` : adapter.promptText(item),
        correctAnswer: adapter.realAnswer(item),
        answers,
        highlights: [texts.highlight],
        ...(isPartyItem(item) ? { partyItem: true } : {}),
      };
    },

    toPublicState(state, viewer: Viewer) {
      const item = state.words[state.index]!;
      const me = viewer.role === "player" ? viewer.playerId : null;
      const revealed = REVEALED_STEPS.includes(state.step) && !!state.options;
      const options = state.options;
      let reveal: BluffPublicState["reveal"] = null;
      if (revealed && options) {
        const revealOptions: BluffRevealOption[] = options.map((o, i) => ({
          text: o.text,
          correct: o.correct,
          authors: o.authors,
          ...(o.decoy ? { decoy: true } : {}),
          voters: Object.entries(state.votes)
            .filter(([, v]) => v.option === i)
            .map(([id]) => id),
        }));
        const extra = adapter.revealExtra?.(item);
        reveal = {
          options: revealOptions,
          correctIndex: options.findIndex((o) => o.correct),
          definition: displayDefinition(adapter.realAnswer(item)),
          lead: adapter.revealLead(item),
          knewItPlayerIds: state.knewIt,
          results: state.results ?? {},
          // Host option (default off): what the authors really wrote.
          originals: state.showOriginals
            ? Object.fromEntries(
                options.flatMap((o) => o.authors).flatMap((id) => (state.submissions[id] ? [[id, state.submissions[id]!.text]] : [])),
              )
            : null,
          ...(extra ? { extra } : {}),
        };
      }
      const story = adapter.story?.(item);
      return {
        step: state.step,
        index: state.index,
        total: state.words.length,
        word: adapter.title(item),
        question: adapter.promptText(item),
        ...(story ? { story } : {}),
        placeholder: adapter.placeholder,
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
        points: (() => {
          const { points, cap } = pointSettings(state);
          return { ...points, cap };
        })(),
        presentLeadMs: BLUFF_CONFIG.presentLeadMs,
        presentMsPerOption: BLUFF_CONFIG.presentMsPerOption,
        reveal,
      };
    },

    listContent: (extra?: readonly unknown[]) => listEntries(pool, adapter.schema, extra, adapter.toEntry),
    parseContent: (raw: unknown) => parseWith(adapter.schema, raw),
  };
  return module;
}
