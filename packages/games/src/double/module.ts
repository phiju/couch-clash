/**
 * Double or Nothing: every player builds their own pot on a ladder of ever
 * harder questions (question n has level n, at most 5 questions).
 *
 *   Question 1: everyone plays. Right → pot = 100, wrong → busted (out).
 *   From question 2 on, each player still in secretly picks first:
 *     CASH OUT – the pot goes onto the account, out for the rest of the round
 *     BET      – right: pot = 2 × pot + 100, wrong (or no answer): pot 0, busted
 *   No choice in time (or no connection) → CASH OUT (the safe default).
 *
 * The choices are uncovered together (showdown) before the question. The
 * round ends when nobody is left or after the last question – whoever is
 * still in then gets the pot credited. Pots: 100 → 300 → 700 → 1,500 → 3,100.
 */
import { QUIZ_QUESTIONS_DE, type QuizQuestion } from "@couch-clash/content";
import type { ReadAloud } from "@couch-clash/shared";
import { z } from "zod";
import { normalizeScoring, type ScoreResult } from "../scoring";
import {
  createKnowledgeModule,
  fixedResult,
  isCorrectAnswer,
  type KnowledgeGame,
  type KnowledgeState,
} from "../knowledge/engine";
import { isKids, joinNames, namesOf, pickLine, spokenName } from "../knowledge/lines";
import { knowledgePool, prepareQuizQuestion } from "../knowledge/questions";
import type { DoubleDecision, DoubleExtra, DoublePlayerView } from "../knowledge/types";
import { planLadder, targetLevel } from "./ladder";
import { DOUBLE_CONFIG, doubleMeta, potAfterWin } from "./meta";

export interface DoublePlayer extends DoublePlayerView {
  /** This question's secret choice ("none" until chosen). */
  decision: DoubleDecision;
}

export interface DoubleGame {
  /** Everyone who plays the round (players joining later only watch). */
  players: Record<string, DoublePlayer>;
  /** The round's questions and their levels, played one by one. */
  ladder: { id: string; level: number }[];
  /** Generated questions on the ladder (static ones are looked up in the pool). */
  extra: QuizQuestion[];
  /** Current question (0-based). */
  index: number;
  /** Every right answer: pot = 2 × pot + bonus. */
  bonus: number;
  /** Names for the host's lines. */
  names: Record<string, string>;
}

export interface RiskAction {
  type: "risk";
  choice: "cash" | "bet";
}

export { potAfterWin };

const ids = (game: DoubleGame, status: DoublePlayer["status"]) =>
  Object.keys(game.players).filter((id) => game.players[id]!.status === status);

/** Still in the round: may choose and answer. */
export const activeIds = (game: DoubleGame) => ids(game, "active");

const withPlayers = (game: DoubleGame, fn: (p: DoublePlayer, id: string) => DoublePlayer): DoubleGame => ({
  ...game,
  players: Object.fromEntries(Object.entries(game.players).map(([id, p]) => [id, fn(p, id)])),
});

export function doubleGame(pool: readonly QuizQuestion[]): KnowledgeGame<DoubleGame, RiskAction> {
  const byId = new Map(pool.map((q) => [q.id, q]));
  const meta = doubleMeta;

  return {
    meta,

    init(ctx, options) {
      const candidates = knowledgePool(pool, options, meta);
      const count = Math.min(options.questionCount, DOUBLE_CONFIG.maxLevel);
      const ladder = planLadder(candidates, count, options, ctx.random);
      const player: DoublePlayer = { pot: 0, status: "active", potBefore: 0, banked: null, lost: 0, auto: false, decision: "none" };
      return {
        game: {
          players: Object.fromEntries(ctx.players.map((p) => [p.id, { ...player }])),
          ladder: ladder.map((s) => ({ id: s.question.id, level: s.level })),
          extra: ladder.map((s) => s.question).filter((q) => !byId.has(q.id)),
          index: 0,
          bonus: normalizeScoring(meta, options.scoring).points?.bonus ?? meta.scoring.points.bonus,
          names: namesOf(ctx, ctx.players.map((p) => p.id)),
        },
        total: ladder.length,
      };
    },

    startQuestion: (game, { index, ctx }) => ({
      ...withPlayers(game, (p) => ({ ...p, decision: "none", potBefore: p.pot })),
      index,
      names: { ...game.names, ...namesOf(ctx, Object.keys(game.players)) },
    }),

    drawQuestion(game, index, ctx) {
      const step = game.ladder[index];
      const raw = step && (byId.get(step.id) ?? game.extra.find((q) => q.id === step.id));
      return raw ? { game, question: prepareQuizQuestion(raw, ctx.random) } : null;
    },

    pre: {
      step: "decide",
      seconds: DOUBLE_CONFIG.decideSeconds,
      showdownSeconds: DOUBLE_CONFIG.showdownSeconds,
      actionSchema: z.object({ type: z.literal("risk"), choice: z.enum(["cash", "bet"]) }),
      // Question 1 is played by everyone without a choice.
      active: (game, index) => index > 0 && activeIds(game).length > 0,
      actors: (game) => activeIds(game),
      acted: (game) => activeIds(game).filter((id) => game.players[id]!.decision !== "none"),
      act(game, action, actorId) {
        const p = game.players[actorId];
        if (!p || p.status !== "active") return { error: "NOT_IN_PLAY" };
        if (p.decision !== "none") return { error: "ALREADY_ANSWERED" };
        return { ...game, players: { ...game.players, [actorId]: { ...p, decision: action.choice } } };
      },
      // No choice in time → CASH OUT; cashing out books the pot and ends the round for that player.
      finish: (game) =>
        withPlayers(game, (p) => {
          if (p.status !== "active") return p;
          const decision = p.decision === "none" ? "cash" : p.decision;
          return decision === "cash" ? { ...p, decision, status: "cashed_out", banked: p.pot } : { ...p, decision };
        }),
      payout: (game) =>
        Object.fromEntries(
          Object.entries(game.players)
            .filter(([, p]) => p.decision === "cash" && p.status === "cashed_out")
            .map(([id, p]) => [id, p.banked ?? 0]),
        ),
      bot: (game, botId, _ctx, bot) => {
        // Braver on easy questions, more careful on hard ones.
        const level = game.ladder[game.index]?.level ?? targetLevel(game.index);
        const pot = game.players[botId]?.pot ?? 0;
        return { type: "risk", choice: bot.random() < 0.85 - level * 0.12 - Math.min(0.2, pot / 10_000) ? "bet" : "cash" };
      },
    },

    answerers: (game) => activeIds(game),

    over: (game) => activeIds(game).length === 0,

    score({ game, question, answers, last }) {
      const results: Record<string, ScoreResult> = {};
      const next = withPlayers(game, (p, id) => {
        if (p.status !== "active") return p;
        if (!isCorrectAnswer(question, answers[id])) {
          // Wrong, no answer or no connection: the pot bursts.
          results[id] = fixedResult(0);
          return { ...p, pot: 0, lost: p.pot, status: "busted" };
        }
        const pot = potAfterWin(p.pot, game.bonus);
        // Still in after the last question → the pot is credited automatically.
        results[id] = fixedResult(last ? pot : 0);
        return last ? { ...p, pot, status: "cashed_out", banked: pot, auto: true } : { ...p, pot };
      });
      return { results, game: next };
    },

    publicExtra(game, { viewer, step }): DoubleExtra {
      // Everything but the secret choice.
      const players: Record<string, DoublePlayerView> = {};
      for (const [id, p] of Object.entries(game.players)) {
        players[id] = { pot: p.pot, status: p.status, potBefore: p.potBefore, banked: p.banked, lost: p.lost, auto: p.auto };
      }
      const decisions: Record<string, "cash" | "bet"> = {};
      for (const [id, p] of Object.entries(game.players)) if (p.decision !== "none") decisions[id] = p.decision;
      return {
        level: game.ladder[game.index]?.level ?? targetLevel(game.index),
        maxLevel: DOUBLE_CONFIG.maxLevel,
        players,
        // Secret until everyone has chosen (or the time is up): uncovered together at the showdown.
        decisions: step === "decide" ? null : decisions,
        myDecision: viewer.role === "player" ? (game.players[viewer.playerId]?.decision ?? null) : null,
        points: { bonus: game.bonus },
      };
    },

    announce: (state) => announceDouble(state),

    revealNotes(state) {
      const notes: Record<string, string> = {};
      const game = state.game;
      for (const id of Object.keys(state.answers)) {
        const p = game.players[id];
        if (!p) continue;
        if (p.status === "busted") notes[id] = `hat gesetzt und den Topf von ${p.lost} Punkten verloren`;
        else if (p.auto) notes[id] = `hat bis zum Schluss durchgezogen und bekommt ${p.banked} Punkte gutgeschrieben`;
        else notes[id] = `hat gesetzt, der Topf wächst auf ${p.pot} Punkte`;
      }
      const level = game.ladder[state.index]?.level ?? targetLevel(state.index);
      const highlights = [`Frage ${state.index + 1} von ${state.total}, Schwierigkeitsstufe ${level} von ${DOUBLE_CONFIG.maxLevel}`];
      const cashed = Object.values(game.players).filter((p) => p.decision === "cash").length;
      if (cashed > 0) highlights.push(`${cashed} ${cashed === 1 ? "Spieler hat" : "Spieler haben"} vor der Frage kassiert`);
      return { notes, highlights };
    },
  };
}

/** "1.500 Punkte". */
const points = (n: number) => `${n.toLocaleString("de-DE")} Punkte`;

function lines(key: string, texts: (string | null | undefined)[]): ReadAloud | null {
  const items = texts.filter((t): t is string => !!t).map((text, i) => ({ cue: `${key}:${i}`, text }));
  return items.length > 0 ? { key, items } : null;
}

/** The level before the choice – from level 4 on with a warning. */
function levelLine(level: number, index: number, kids: boolean, key: string): string {
  const n = index + 1;
  if (level >= DOUBLE_CONFIG.warnLevel) {
    return kids
      ? pickLine([`Frage ${n}, Stufe ${level} – jetzt wird's richtig knifflig!`, `Stufe ${level}! Die ist schwer – überlegt gut.`], key)
      : pickLine(
          [`Achtung, Stufe ${level}! Jetzt wird's richtig fies …`, `Frage ${n}, Stufe ${level}. Jetzt wird's richtig fies … Kassieren oder zocken?`],
          key,
        );
  }
  return kids
    ? pickLine([`Frage ${n}, Stufe ${level}. Kassieren oder weiterspielen?`, `Stufe ${level}! Nehmt ihr die Punkte – oder traut ihr euch?`], key)
    : pickLine([`Frage ${n}, Stufe ${level}. Kassieren oder setzen?`, `Stufe ${level} – noch harmlos. Oder? Kassieren oder zocken?`], key);
}

/** The host: the level before the choice, the showdown, the big losses. */
export function announceDouble(state: KnowledgeState<DoubleGame>): ReadAloud | null {
  const game = state.game;
  const kids = isKids(state.mode);
  const name = (id: string) => spokenName(game.names[id]);
  const level = game.ladder[state.index]?.level ?? targetLevel(state.index);
  const active = activeIds(game);

  if (state.step === "decide") {
    const key = `double:decide:${state.index}`;
    const alone = active.length === 1 ? active[0]! : null;
    const pot = alone ? game.players[alone]!.pot : 0;
    const allIn = alone
      ? kids
        ? `Nur noch ${name(alone)} ist dabei: ${points(pot)} nehmen – oder ${points(potAfterWin(pot, game.bonus))} holen?`
        : pickLine(
            [
              `Nur noch ${name(alone)}. Alles oder nichts … ${points(pot)} – oder ${points(potAfterWin(pot, game.bonus))}?`,
              `${name(alone)}, du bist allein. Alles oder nichts …`,
            ],
            key,
          )
      : null;
    return lines(key, [levelLine(level, state.index, kids, key), allIn]);
  }

  if (state.step === "showdown") {
    const key = `double:showdown:${state.index}`;
    const cashers = Object.keys(game.players).filter((id) => game.players[id]!.decision === "cash");
    const betters = Object.keys(game.players).filter((id) => game.players[id]!.decision === "bet");
    if (cashers.length + betters.length === 0) return null;
    if (betters.length === 0) {
      return lines(key, [
        kids
          ? "Alle nehmen ihre Punkte mit – ganz schön schlau!"
          : pickLine(["Alle kassieren. Keiner traut sich – ihr Feiglinge!", "Alle nehmen das Geld und rennen. Wie langweilig!"], key),
      ]);
    }
    if (cashers.length === 0) {
      return lines(key, [
        kids
          ? "Alle spielen weiter – ihr seid ja mutig!"
          : pickLine([`Alle setzen! Mutig – oder einfach verrückt?`, `Keiner kassiert. Ihr Zocker!`], key),
      ]);
    }
    const casher = pickLine(cashers, key);
    const one = betters.length === 1;
    const bettor = betters.length > 2 ? "Der Rest" : joinNames(betters.map(name));
    const banked = game.players[casher]!.banked ?? 0;
    return lines(key, [
      kids
        ? `${name(casher)} nimmt ${points(banked)} mit. ${bettor} ${one ? "spielt" : "spielen"} weiter!`
        : pickLine(
            [
              `${name(casher)} kassiert feige ${points(banked)} – ${bettor} ${one ? "zockt" : "zocken"} weiter!`,
              `${bettor} ${one ? "setzt" : "setzen"} alles. ${name(casher)} nimmt lieber das Geld.`,
            ],
            key,
          ),
    ]);
  }

  if (state.step === "reveal") {
    const key = `double:reveal:${state.index}`;
    const played = Object.keys(state.results ?? {}).filter((id) => game.players[id]);
    const busted = played.filter((id) => game.players[id]!.status === "busted");
    const winners = played.filter((id) => game.players[id]!.status !== "busted");
    const biggest = busted.sort((a, b) => game.players[b]!.lost - game.players[a]!.lost)[0];
    const lost = biggest ? game.players[biggest]!.lost : 0;
    let main: string | null = null;
    if (biggest && lost >= 300) {
      const n = name(biggest);
      main = kids
        ? pickLine([`Oh nein, ${n} – der Topf ist geplatzt! Beim nächsten Mal!`, `Puff! ${n}s Topf ist weg. Mutig war's trotzdem!`], key)
        : pickLine(
            [
              `${n} verzockt ${points(lost)}. Autsch – das war teuer!`,
              `Tschüss, ${points(lost)}! ${n}, das war wohl nix.`,
              `${points(lost)} futsch! ${n}, hättest du mal kassiert …`,
            ],
            key,
          );
    } else if (winners.length > 0) {
      const top = winners.sort((a, b) => game.players[b]!.pot - game.players[a]!.pot)[0]!;
      const p = game.players[top]!;
      main = p.auto
        ? `${name(top)} bringt ${points(p.pot)} ins Ziel!`
        : kids
          ? `Richtig, ${name(top)}! Dein Topf wächst auf ${points(p.pot)}.`
          : pickLine([`${name(top)} verdoppelt – der Topf wiegt jetzt ${points(p.pot)}!`, `Weiter geht's, ${name(top)}: ${points(p.pot)} im Topf!`], key);
    } else if (biggest) {
      main = kids ? "Oh je – alle Töpfe sind geplatzt!" : "Alle Töpfe geplatzt. Das Haus gewinnt!";
    }
    const last = state.index + 1 >= state.total;
    const alone = !last && active.length === 1 ? active[0]! : null;
    const tension = alone
      ? kids
        ? `Nur noch ${name(alone)} ist im Spiel!`
        : `Nur noch ${name(alone)} ist im Spiel … alles oder nichts.`
      : null;
    return lines(key, [main, tension]);
  }
  return null;
}

export function createDoubleModule(pool: readonly QuizQuestion[] = QUIZ_QUESTIONS_DE) {
  return createKnowledgeModule(doubleGame(pool), pool);
}

export const doubleModule = createDoubleModule();
