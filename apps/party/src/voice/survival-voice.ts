/**
 * The host's voice in the Survival-Finale: new game events → the commentary
 * engine → a host line with cached audio. Audio for every line is prepared
 * in the background when the finale starts (nameless lines once for all
 * rooms, `{playerName}` lines per player – the likeliest events first).
 * Nothing here ever delays the game: a line whose audio isn't ready simply
 * isn't picked.
 */
import type { SurvivalEvent, SurvivalState } from "@couch-clash/games";
import type { HostLine } from "@couch-clash/shared";
import { chooseComment, createCommentaryMemory, type CommentaryMemory } from "./survival-commentary";
import { RUNNING_GAGS, SURVIVAL_LINES, fillLine, namelessLines, PLAYER_NAME, type ModeratorPoolId } from "./survival-lines";

export const SURVIVAL_VOICE_CONFIG = {
  /** ElevenLabs credits the finale may spend on NEW audio (on top of what is cached). */
  maxNewCreditsPerFinale: 6_000,
  /** `{playerName}` lines voiced per player and event (likeliest events first). */
  namedLinesPerEvent: 2,
  /** Parallel voice requests while warming up. */
  parallel: 3,
  /** Events that waited for the cache check are still spoken up to this age. */
  pendingMaxAgeMs: 4_000,
  /** Events whose named lines are voiced first. */
  namedEvents: ["WRONG_ANSWER", "CRITICAL", "ELIMINATED", "WINNER", "NEAR_ELIMINATION", "TIME_DECAY_STARTED", "FAST_CORRECT", "COMEBACK", "WARNING", "TIMEOUT"],
  /** Nameless pools voiced first (the intro needs them right away). */
  firstPools: ["FINALE_STARTED", "SCORES_CONVERTED", "ELIMINATED", "WRONG_ANSWER", "CRITICAL", "WINNER"],
} as const satisfies { namedEvents: readonly ModeratorPoolId[]; firstPools: readonly ModeratorPoolId[] } & Record<string, unknown>;

export interface SurvivalClip {
  path: string | null;
  /** Was in the global cache already (free). */
  cached: boolean;
  /** The voice service refused – stop generating. */
  refused?: boolean;
}

export interface SurvivalVoiceRuntime {
  /** Voice switched on, a host screen listening, a cache available. */
  enabled(): boolean;
  /** NEW audio may be generated in this room (service ok, budget left). */
  allowNew(): boolean;
  /** A clip from the global voice cache; `reserve` pays for a new one (false → not generated). */
  clip(text: string, allowNew: boolean, reserve: (credits: number) => Promise<boolean>): Promise<SurvivalClip>;
  /** Takes credits from the room's budget. */
  reserveCredits(credits: number): Promise<boolean>;
  send(line: HostLine): boolean;
  playbackRate(): number;
  now(): number;
  random(): number;
  newId(): string;
  run(task: () => Promise<void>): void;
  log(message: string): void;
}

/** A finale is identified by its players and the moment it started. */
function finaleKey(state: SurvivalState): string {
  const started = state.events.find((e) => e.type === "FINALE_STARTED")?.at ?? 0;
  return `${started}:${state.players.map((p) => p.id).join(",")}`;
}

export class SurvivalVoice {
  private key: string | null = null;
  private lastSeq = 0;
  private memory: CommentaryMemory = createCommentaryMemory();
  /** Spoken text → cached audio path. */
  private readonly ready = new Map<string, string>();
  private spent = 0;
  private stopped = false;
  /** Until the cache is checked, events wait here (the intro line must not get lost). */
  private pending: { events: SurvivalEvent[]; state: SurvivalState; names: Readonly<Record<string, string>> } | null = null;
  private checked = false;

  constructor(private readonly rt: SurvivalVoiceRuntime) {}

  /** The room changed while the finale runs. `names`: player id → sanitized name. */
  roomChanged(state: SurvivalState, names: Readonly<Record<string, string>>) {
    const key = finaleKey(state);
    const maxSeq = state.events.at(-1)?.seq ?? 0;
    if (key !== this.key) {
      this.key = key;
      this.memory = createCommentaryMemory();
      this.spent = 0;
      this.stopped = false;
      this.checked = false;
      this.pending = null;
      // A restarted room (or a finale already running) never replays old events.
      const fresh = state.step === "intro" && state.events.every((e) => this.rt.now() - e.at < 5_000);
      this.lastSeq = fresh ? 0 : maxSeq;
      if (this.rt.enabled()) this.rt.run(() => this.warmUp(state, names));
    }
    const events = state.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = Math.max(this.lastSeq, maxSeq);
    if (events.length === 0 || !this.rt.enabled()) return;
    if (!this.checked) {
      this.pending = { events: [...(this.pending?.events ?? []), ...events], state, names };
      return;
    }
    this.speak(events, state, names);
  }

  /** Events that waited for the cache check – only if still fresh (a late line is worse than none). */
  private flushPending() {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    const fresh = pending.events.filter((e) => this.rt.now() - e.at <= SURVIVAL_VOICE_CONFIG.pendingMaxAgeMs);
    if (fresh.length) this.speak(fresh, pending.state, pending.names);
  }

  private speak(events: readonly SurvivalEvent[], state: SurvivalState, names: Readonly<Record<string, string>>) {
    const decaySeconds = Object.fromEntries(state.config.phases.map((p) => [p.id, p.scoreDecayThreshold]));
    const { comment, memory } = chooseComment(events, this.memory, {
      now: this.rt.now(),
      names,
      decaySeconds,
      random: () => this.rt.random(),
      ready: (text) => this.ready.has(text),
    });
    this.memory = memory;
    if (!comment) return;
    const audioPath = this.ready.get(comment.text);
    if (!audioPath) return;
    this.rt.send({
      id: this.rt.newId(),
      kind: "comment",
      text: comment.text,
      audioPath,
      playbackRate: this.rt.playbackRate(),
      staleAfterMs: comment.maxQueueAgeMs,
      priority: comment.priority,
      ...(comment.preempt ? { preempt: true } : {}),
      ...(comment.playAt !== null ? { playAt: comment.playAt } : {}),
    });
  }

  /** Texts ready to play (tests / logs). */
  get readyCount(): number {
    return this.ready.size;
  }

  /** Prepares audio: everything cached first (free), then new clips in order of need, within the finale's budget. */
  private async warmUp(state: SurvivalState, names: Readonly<Record<string, string>>) {
    const key = this.key;
    const decay = [...new Set(state.config.phases.map((p) => p.scoreDecayThreshold))];
    const first = new Set(SURVIVAL_VOICE_CONFIG.firstPools.flatMap((id) => SURVIVAL_LINES[id]));
    const nameless = namelessLines(decay).sort((a, b) => Number(first.has(b)) - Number(first.has(a)));
    const named = this.namedTexts(state, names);
    const all = [...nameless, ...named.priority, ...named.rest];

    // 1. What is cached already costs nothing.
    await this.each(all, async (text) => {
      const clip = await this.rt.clip(text, false, async () => false);
      if (clip.path) this.ready.set(text, clip.path);
    });
    const before = this.ready.size;
    if (this.key !== key) return;
    this.checked = true;
    this.flushPending();
    // 2. Missing clips, most needed first.
    let generated = 0;
    if (this.rt.allowNew()) {
      const order = [...nameless.filter((t) => first.has(t)), ...named.priority, ...nameless.filter((t) => !first.has(t)), ...named.rest];
      await this.each(order, async (text) => {
        if (this.ready.has(text) || this.stopped || this.key !== key) return;
        const clip = await this.rt.clip(text, true, (credits) => this.reserve(credits));
        if (clip.refused) this.stopped = true;
        if (clip.path) {
          this.ready.set(text, clip.path);
          if (!clip.cached) generated++;
        }
      });
    }
    this.rt.log(
      `survival voice: ${this.ready.size}/${all.length} lines ready (${before} cached, ${generated} new, ${this.spent} credits this finale, ${named.priority.length + named.rest.length} with names)`,
    );
  }

  /** `{playerName}` lines per player: the likeliest events first, the rest after. */
  private namedTexts(state: SurvivalState, names: Readonly<Record<string, string>>) {
    const priority: string[] = [];
    const rest: string[] = [];
    const decay = state.config.phases[0]?.scoreDecayThreshold;
    const gagTexts = Object.values(RUNNING_GAGS).flatMap((g) => g.stages.map((s) => s.text as string));
    for (const p of state.players) {
      const name = names[p.id];
      if (!name) continue;
      const fill = (t: string) => fillLine(t, { playerName: name, decaySeconds: decay });
      for (const id of SURVIVAL_VOICE_CONFIG.namedEvents) {
        const lines = SURVIVAL_LINES[id].filter((t) => t.includes(PLAYER_NAME));
        priority.push(...lines.slice(0, SURVIVAL_VOICE_CONFIG.namedLinesPerEvent).map(fill));
        rest.push(...lines.slice(SURVIVAL_VOICE_CONFIG.namedLinesPerEvent).map(fill));
      }
      rest.push(...gagTexts.filter((t) => t.includes(PLAYER_NAME)).map(fill));
    }
    // Events outside the list (e.g. FINAL_TWO has no named lines today) stay covered by `rest`.
    for (const [id, lines] of Object.entries(SURVIVAL_LINES)) {
      if ((SURVIVAL_VOICE_CONFIG.namedEvents as readonly string[]).includes(id)) continue;
      for (const p of state.players) {
        const name = names[p.id];
        if (name) rest.push(...lines.filter((t) => t.includes(PLAYER_NAME)).map((t) => fillLine(t, { playerName: name })));
      }
    }
    return { priority: [...new Set(priority)], rest: [...new Set(rest)] };
  }

  /** The finale's own cap first, then the room's budget. */
  private async reserve(credits: number): Promise<boolean> {
    if (this.spent + credits > SURVIVAL_VOICE_CONFIG.maxNewCreditsPerFinale) return false;
    if (!(await this.rt.reserveCredits(credits))) return false;
    this.spent += credits;
    return true;
  }

  private async each(items: readonly string[], fn: (text: string) => Promise<void>) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) await fn(items[i++]!);
    };
    await Promise.all(Array.from({ length: SURVIVAL_VOICE_CONFIG.parallel }, worker));
  }
}
