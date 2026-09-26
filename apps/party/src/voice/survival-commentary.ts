/**
 * Survival-Finale commentary engine (pure, unit-tested). Game events in,
 * at most one comment out – with priority, cooldowns, no direct repeats and
 * small running gags per player. It never waits for anything: only lines
 * whose audio is ready (`ready`) can be picked; a named line that isn't
 * ready falls back to a nameless one from the same pool.
 *
 * Text, audio and the moderator's animation are separate consumers of the
 * chosen comment (the director voices it; captions could show `text`).
 */
import { SURVIVAL_CONFIG, type SurvivalEvent } from "@couch-clash/games";
import {
  PLAYER_NAME,
  RUNNING_GAGS,
  SURVIVAL_LINES,
  fillLine,
  type GagId,
  type ModeratorEventType,
  type ModeratorPoolId,
} from "./survival-lines";

export const COMMENTARY_CONFIG = {
  /** Normal comments: at least this long after the previous comment. */
  globalCooldownMs: 3_500,
  /** Normal comments about the same player: at least this long apart. */
  playerCooldownMs: 9_000,
  /** A line never comes back within this many comments. */
  recentLines: 14,
  /** A queued comment that could not start in this time is dropped (a stale "Minus zehn …" is worse than none). */
  commentMaxQueueAge: 2_500,
  /** TIME_DECAY_STARTED this often (incl. this one) starts the "slow" gag. */
  slowGagAfter: 2,
  /** "PLATSCH!" lands on the splash (the TV lets the car sink ~1.35 s after the elimination). */
  splashImpactMs: 1_350,
  /** The opening line comes after the short pause of the start sequence. */
  launchPauseMs: SURVIVAL_CONFIG.launchPauseMs,
  /** The WINNER line comes when the winner's platform has ridden up (TV: 1.5 s). */
  winnerRiseMs: 1_500,
} as const;

/** 1 = most important. Comments of priority ≤ 4 ignore cooldowns. */
export const MODERATOR_PRIORITY: Record<ModeratorEventType, number> = {
  WINNER: 1,
  ELIMINATED: 2,
  SUDDEN_DEATH: 3,
  TIEBREAK: 3,
  FINAL_TWO: 4,
  WRONG_ANSWER: 5,
  CRITICAL: 6,
  NEAR_ELIMINATION: 6,
  MULTIPLE_PLAYERS_CRITICAL: 6,
  COMEBACK: 7,
  TIME_DECAY_STARTED: 8,
  TIMEOUT: 8,
  FINALE_STARTED: 9,
  SCORES_CONVERTED: 9,
  PHASE_CHANGED: 9,
  FAST_CORRECT: 9,
  WARNING: 9,
};

/** These always get a line (the show's big moments) – cooldowns don't apply. */
const ALWAYS: ReadonlySet<ModeratorEventType> = new Set([
  "WINNER",
  "ELIMINATED",
  "SUDDEN_DEATH",
  "TIEBREAK",
  "FINAL_TWO",
  "FINALE_STARTED",
  "PHASE_CHANGED",
]);

/** May cut a lower comment that is still playing (short fade, no hard cut). */
const PREEMPTS: ReadonlySet<ModeratorEventType> = new Set(["WINNER", "ELIMINATED", "SUDDEN_DEATH"]);

/** What the moderator reacts to – also the context a future AI line would get. */
export interface ModeratorCommentEvent {
  type: ModeratorEventType;
  playerId?: string;
  playerName?: string;
  score?: number;
  previousScore?: number;
  scoreChange?: number;
  responseTime?: number;
  severity?: string;
  phase?: string;
  /** Server time of the game event. */
  at: number;
}

export interface ModeratorComment {
  event: ModeratorCommentEvent;
  /** The spoken text (name and seconds filled in). */
  text: string;
  /** The pool line it came from. */
  template: string;
  priority: number;
  preempt: boolean;
  /** Server time to start playing (eliminations: the splash). */
  playAt: number | null;
  /** Drop it when it could not start within this time. */
  maxQueueAgeMs: number;
}

export interface PlayerMemory {
  lastAt: number | null;
  /** Last events of this player, newest last. */
  events: ModeratorEventType[];
  slow: number;
  wrong: number;
  nearDeath: number;
  comebacks: number;
  /** Running gags: next stage index per gag (missing = not started). */
  gags: Partial<Record<GagId, number>>;
  /** Lines said about this player. */
  lines: string[];
}

export interface CommentaryMemory {
  /** Templates said most recently (newest last). */
  recent: string[];
  /** Templates said in this finale. */
  used: string[];
  lastAt: number | null;
  players: Record<string, PlayerMemory>;
}

export function createCommentaryMemory(): CommentaryMemory {
  return { recent: [], used: [], lastAt: null, players: {} };
}

export interface CommentaryInput {
  now: number;
  names: Readonly<Record<string, string>>;
  /** Decay threshold per phase id (for "{decaySeconds} Sekunden!"). */
  decaySeconds: Readonly<Record<string, number>>;
  random: () => number;
  /** Is the audio of this exact text ready? Only ready lines are picked. */
  ready: (text: string) => boolean;
}

const blankPlayer = (): PlayerMemory => ({ lastAt: null, events: [], slow: 0, wrong: 0, nearDeath: 0, comebacks: 0, gags: {}, lines: [] });

/** One game event → moderator events (a multi-player event becomes one per player, or one nameless). */
export function toModeratorEvents(e: SurvivalEvent, names: Readonly<Record<string, string>>): ModeratorCommentEvent[] {
  // The finale opens during the rules (intro sound only); the moderator speaks at the start sequence (LAUNCH).
  if (e.type === "FINALE_STARTED") return [];
  const type = (e.type === "LAUNCH" ? "FINALE_STARTED" : e.type) as ModeratorEventType;
  const base = {
    type,
    at: e.at,
    ...(e.score !== undefined ? { score: e.score } : {}),
    ...(e.previousScore !== undefined ? { previousScore: e.previousScore } : {}),
    ...(e.scoreChange !== undefined ? { scoreChange: e.scoreChange } : {}),
    ...(e.responseMs !== undefined ? { responseTime: e.responseMs / 1000 } : {}),
    ...(e.danger ? { severity: e.danger } : {}),
    ...(e.phase ? { phase: e.phase } : {}),
  };
  const withPlayer = (id: string) => ({ ...base, playerId: id, ...(names[id] ? { playerName: names[id] } : {}) });
  if (e.playerId) return [withPlayer(e.playerId)];
  // TIME_DECAY_STARTED / TIMEOUT for exactly one player: about them; several: about everyone.
  if ((type === "TIME_DECAY_STARTED" || type === "TIMEOUT") && e.playerIds?.length === 1) return [withPlayer(e.playerIds[0]!)];
  return [base];
}

function remember(memory: CommentaryMemory, events: readonly ModeratorCommentEvent[]): CommentaryMemory {
  const players = { ...memory.players };
  const bump = (id: string, fn: (p: PlayerMemory) => PlayerMemory) => {
    players[id] = fn({ ...(players[id] ?? blankPlayer()) });
  };
  for (const e of events) {
    if (!e.playerId) continue;
    bump(e.playerId, (p) => ({
      ...p,
      events: [...p.events, e.type].slice(-8),
      slow: p.slow + (e.type === "TIME_DECAY_STARTED" ? 1 : 0),
      wrong: p.wrong + (e.type === "WRONG_ANSWER" ? 1 : 0),
      nearDeath: p.nearDeath + (e.type === "NEAR_ELIMINATION" ? 1 : 0),
      comebacks: p.comebacks + (e.type === "COMEBACK" ? 1 : 0),
    }));
  }
  return { ...memory, players };
}

/** A running gag line for this event, if one of the player's gags is due. */
function gagFor(e: ModeratorCommentEvent, p: PlayerMemory | undefined): { gag: GagId; stage: number; text: string } | null {
  if (!p || !e.playerId) return null;
  // Gag in progress: its next stage.
  for (const [id, stage] of Object.entries(p.gags) as [GagId, number][]) {
    const next = RUNNING_GAGS[id].stages[stage] as { on: string; also?: string; text: string } | undefined;
    if (next && (next.on === e.type || next.also === e.type)) return { gag: id, stage, text: next.text };
  }
  if (p.gags.slow === undefined && e.type === "TIME_DECAY_STARTED" && p.slow >= COMMENTARY_CONFIG.slowGagAfter) {
    return { gag: "slow", stage: 0, text: RUNNING_GAGS.slow.stages[0].text };
  }
  if (p.gags.wrongAgain === undefined && e.type === "WRONG_ANSWER" && p.wrong >= 2) {
    return { gag: "wrongAgain", stage: 0, text: RUNNING_GAGS.wrongAgain.stages[0].text };
  }
  return null;
}

/** Lines timed to the stage: the splash, the opening after the pause, the winner after the ride up. */
function playAtFor(e: ModeratorCommentEvent): number | null {
  switch (e.type) {
    case "ELIMINATED":
      return e.at + COMMENTARY_CONFIG.splashImpactMs;
    case "FINALE_STARTED":
      return e.at + COMMENTARY_CONFIG.launchPauseMs;
    case "WINNER":
      return e.at + COMMENTARY_CONFIG.winnerRiseMs;
    default:
      return null;
  }
}

/** The line that sends everyone to the ceremony (after the WINNER line): a ready one, not said lately. */
export function chooseTransition(memory: CommentaryMemory, input: Pick<CommentaryInput, "random" | "ready">): string | null {
  const ready = SURVIVAL_LINES.TRANSITION_TO_CEREMONY.filter((t) => input.ready(t));
  const fresh = ready.filter((t) => !memory.recent.includes(t));
  const pool = fresh.length ? fresh : ready;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(input.random() * pool.length))]!;
}

function poolFor(e: ModeratorCommentEvent): ModeratorPoolId {
  if (e.type === "PHASE_CHANGED" && e.phase === "death") return "PHASE_CHANGED_DEATH";
  return e.type;
}

/**
 * The comment for these events (at most one), and the updated memory. The
 * memory also learns from events that got no comment (slowness, wrong answers …).
 */
export function chooseComment(
  events: readonly SurvivalEvent[],
  memory: CommentaryMemory,
  input: CommentaryInput,
): { comment: ModeratorComment | null; memory: CommentaryMemory } {
  const moderatorEvents = events.flatMap((e) => toModeratorEvents(e, input.names));
  let mem = remember(memory, moderatorEvents);
  // Most important first; among equals the latest.
  const candidates = [...moderatorEvents].sort((a, b) => MODERATOR_PRIORITY[a.type] - MODERATOR_PRIORITY[b.type] || b.at - a.at);

  for (const e of candidates) {
    const priority = MODERATOR_PRIORITY[e.type];
    const always = ALWAYS.has(e.type);
    const player = e.playerId ? mem.players[e.playerId] : undefined;
    if (!always && mem.lastAt !== null && input.now - mem.lastAt < COMMENTARY_CONFIG.globalCooldownMs) continue;
    if (!always && player?.lastAt != null && input.now - player.lastAt < COMMENTARY_CONFIG.playerCooldownMs) continue;

    const fill = (template: string) =>
      fillLine(template, { playerName: e.playerName, decaySeconds: e.phase ? input.decaySeconds[e.phase] : undefined });
    const usable = (template: string) => {
      if (template.includes(PLAYER_NAME) && !e.playerName) return false;
      return input.ready(fill(template));
    };

    let template: string | null = null;
    let gagUpdate: { gag: GagId; stage: number } | null = null;
    const gag = gagFor(e, player);
    if (gag && usable(gag.text)) {
      template = gag.text;
      gagUpdate = { gag: gag.gag, stage: gag.stage + 1 };
    } else {
      const pool = SURVIVAL_LINES[poolFor(e)].filter((t) => usable(t) && !mem.recent.includes(t));
      if (pool.length === 0) continue;
      // Fresh lines first; lines with the name are a bit more personal.
      const fresh = pool.filter((t) => !mem.used.includes(t));
      const choices = fresh.length ? fresh : pool;
      const named = choices.filter((t) => t.includes(PLAYER_NAME));
      const pick = named.length && input.random() < 0.6 ? named : choices;
      template = pick[Math.min(pick.length - 1, Math.floor(input.random() * pick.length))]!;
      if (template === RUNNING_GAGS.slimeFan.start && e.playerId) gagUpdate = { gag: "slimeFan", stage: 0 };
    }

    const text = fill(template);
    mem = {
      ...mem,
      recent: [...mem.recent, template].slice(-COMMENTARY_CONFIG.recentLines),
      used: [...mem.used, template],
      lastAt: input.now,
    };
    if (e.playerId) {
      const p = { ...(mem.players[e.playerId] ?? blankPlayer()) };
      p.lastAt = input.now;
      p.lines = [...p.lines, text].slice(-6);
      if (gagUpdate) p.gags = { ...p.gags, [gagUpdate.gag]: gagUpdate.stage };
      mem = { ...mem, players: { ...mem.players, [e.playerId]: p } };
    }
    return {
      comment: {
        event: e,
        text,
        template,
        priority,
        preempt: PREEMPTS.has(e.type),
        playAt: playAtFor(e),
        maxQueueAgeMs: COMMENTARY_CONFIG.commentMaxQueueAge,
      },
      memory: mem,
    };
  }
  return { comment: null, memory: mem };
}

/**
 * Everything an AI line would need (optional enhancement later): the event,
 * the player's story so far and the last things the host said. Local lines
 * never wait for it; an AI line would go through the same queue rules.
 */
export function aiCommentContext(e: ModeratorCommentEvent, memory: CommentaryMemory) {
  const p = e.playerId ? memory.players[e.playerId] : undefined;
  return {
    event: e,
    playerHistory: p ? { recentEvents: p.events, slow: p.slow, wrong: p.wrong, nearDeath: p.nearDeath, comebacks: p.comebacks } : null,
    runningGags: p?.gags ?? {},
    recentComments: memory.recent.slice(-5),
  };
}
