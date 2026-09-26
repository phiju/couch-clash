/**
 * The host's voice in Pixelpanik: new game events (wrong guess, early hit,
 * nobody got it, …) → one line from pixelpanik-lines.ts with cached audio.
 *
 * Audio is prepared in the background when a round starts: nameless lines
 * once for all rooms, `{name}` lines per player (a few per situation first,
 * the rest after, within a credit cap per round). Only lines whose audio is
 * ready are picked – nothing here ever delays the game.
 */
import type { PixelpanikEvent, PixelpanikEventType, PixelpanikState } from "@couch-clash/games";
import type { GameMode, HostLine } from "@couch-clash/shared";
import { NAME, PIXELPANIK_SITUATIONS, fillName, linesFor, type PixelpanikSituation } from "./pixelpanik-lines";
import type { SurvivalVoiceRuntime } from "./survival-voice";

export const PIXELPANIK_VOICE_CONFIG = {
  /** The last lines per situation that may not come again. */
  lockedPerSituation: 3,
  /** ElevenLabs credits a round may spend on NEW audio (on top of what is cached). */
  maxNewCreditsPerRound: 4_000,
  /** `{name}` lines voiced first per player and situation (the rest follows while budget lasts). */
  namedFirst: 3,
  parallel: 3,
  /** A line that can't start this soon after the event is dropped (the moment is gone). */
  staleAfterMs: 2_500,
  /** At least this long between two lines (except "nobody" at the solution). */
  minGapMs: 2_000,
  /** Events older than this are not commented any more. */
  maxEventAgeMs: 3_000,
} as const;

const SITUATION_OF: Partial<Record<PixelpanikEventType, PixelpanikSituation>> = {
  NOBODY_YET: "nobodyYet",
  WRONG: "wrong",
  EARLY_CORRECT: "earlyCorrect",
  LATE_CORRECT: "lateCorrect",
  NOBODY: "nobody",
};

/** Most important first (queue priority on the host: lower = sooner). */
const PRIORITY: Record<PixelpanikSituation, number> = {
  nobody: 2,
  earlyCorrect: 3,
  wrong: 4,
  lateCorrect: 4,
  nobodyYet: 5,
};

export interface PixelpanikVoiceMemory {
  /** Per situation: the last lines (templates) played, newest last. */
  recent: Partial<Record<PixelpanikSituation, string[]>>;
  lastSpokenAt: number | null;
}

export const createPixelpanikMemory = (): PixelpanikVoiceMemory => ({ recent: {}, lastSpokenAt: null });

export interface PixelpanikPick {
  situation: PixelpanikSituation;
  /** The line as written (with `{name}`) – what the no-repeat rule remembers. */
  template: string;
  /** What the host says. */
  text: string;
  priority: number;
}

export interface PixelpanikChooseInput {
  mode: GameMode;
  /** player id → sanitized name */
  names: Readonly<Record<string, string>>;
  now: number;
  random: () => number;
  /** Is this text's audio ready? */
  ready: (text: string) => boolean;
}

/**
 * Pure: which line (if any) the host says about these new events. The most
 * important situation wins; a line is never one of the last 3 of its
 * situation; only lines with audio ready are picked.
 */
export function choosePixelpanikLine(
  events: readonly PixelpanikEvent[],
  memory: PixelpanikVoiceMemory,
  input: PixelpanikChooseInput,
): { pick: PixelpanikPick | null; memory: PixelpanikVoiceMemory } {
  const fresh = events
    .filter((e) => input.now - e.at <= PIXELPANIK_VOICE_CONFIG.maxEventAgeMs)
    .flatMap((e) => {
      const situation = SITUATION_OF[e.type];
      return situation ? [{ event: e, situation }] : [];
    })
    // Most important first; within a situation the newest event.
    .sort((a, b) => PRIORITY[a.situation] - PRIORITY[b.situation] || b.event.seq - a.event.seq);

  const busy = memory.lastSpokenAt !== null && input.now - memory.lastSpokenAt < PIXELPANIK_VOICE_CONFIG.minGapMs;
  for (const { event, situation } of fresh) {
    if (busy && situation !== "nobody") continue;
    const name = event.playerId ? input.names[event.playerId] : undefined;
    const locked = new Set(memory.recent[situation] ?? []);
    const options = linesFor(situation, input.mode).filter((t) => !locked.has(t) && (name !== undefined || !t.includes(NAME)));
    const candidates = options.map((template) => ({ template, text: name ? fillName(template, name) : template })).filter((c) => input.ready(c.text));
    if (candidates.length === 0) continue;
    const chosen = candidates[Math.min(candidates.length - 1, Math.floor(input.random() * candidates.length))]!;
    const recent = [...(memory.recent[situation] ?? []), chosen.template].slice(-PIXELPANIK_VOICE_CONFIG.lockedPerSituation);
    return {
      pick: { situation, template: chosen.template, text: chosen.text, priority: PRIORITY[situation] },
      memory: { recent: { ...memory.recent, [situation]: recent }, lastSpokenAt: input.now },
    };
  }
  return { pick: null, memory };
}

/** Every text a round may need: nameless ones, then `{name}` lines per player (a few first, the rest after). */
export function pixelpanikTexts(mode: GameMode, names: Readonly<Record<string, string>>, random?: () => number) {
  const nameless: string[] = [];
  const first: string[] = [];
  const rest: string[] = [];
  for (const situation of PIXELPANIK_SITUATIONS) {
    const lines = linesFor(situation, mode);
    nameless.push(...lines.filter((t) => !t.includes(NAME)));
    // A different few first every round – the global cache grows more varied over time.
    const named = shuffled(lines.filter((t) => t.includes(NAME)), random);
    for (const name of Object.values(names)) {
      first.push(...named.slice(0, PIXELPANIK_VOICE_CONFIG.namedFirst).map((t) => fillName(t, name)));
      rest.push(...named.slice(PIXELPANIK_VOICE_CONFIG.namedFirst).map((t) => fillName(t, name)));
    }
  }
  const unique = (xs: string[]) => [...new Set(xs)];
  return { nameless: unique(nameless), first: unique(first), rest: unique(rest) };
}

function shuffled<T>(items: readonly T[], random?: () => number): T[] {
  const out = [...items];
  if (!random) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export class PixelpanikVoice {
  private key: string | null = null;
  private lastSeq = 0;
  private memory = createPixelpanikMemory();
  /** Spoken text → cached audio path. */
  private readonly ready = new Map<string, string>();
  private spent = 0;
  private stopped = false;

  constructor(private readonly rt: SurvivalVoiceRuntime) {}

  /** The room changed while Pixelpanik runs. `names`: player id → sanitized name. */
  roomChanged(state: PixelpanikState, names: Readonly<Record<string, string>>, mode: GameMode) {
    const maxSeq = state.events.at(-1)?.seq ?? 0;
    if (state.roundKey !== this.key) {
      this.key = state.roundKey;
      this.memory = createPixelpanikMemory();
      this.spent = 0;
      this.stopped = false;
      // A restarted room never replays old events.
      this.lastSeq = maxSeq;
      if (this.rt.enabled()) this.rt.run(() => this.warmUp(state.roundKey, names, mode));
      return;
    }
    const events = state.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = Math.max(this.lastSeq, maxSeq);
    if (events.length === 0 || !this.rt.enabled()) return;
    const { pick, memory } = choosePixelpanikLine(events, this.memory, {
      mode,
      names,
      now: this.rt.now(),
      random: () => this.rt.random(),
      ready: (text) => this.ready.has(text),
    });
    if (!pick) return;
    const audioPath = this.ready.get(pick.text);
    if (!audioPath) return;
    this.memory = memory;
    this.rt.send({
      id: this.rt.newId(),
      kind: "comment",
      text: pick.text,
      audioPath,
      playbackRate: this.rt.playbackRate(),
      staleAfterMs: PIXELPANIK_VOICE_CONFIG.staleAfterMs,
      priority: pick.priority,
    } satisfies HostLine);
  }

  /** Texts ready to play (tests / logs). */
  get readyCount(): number {
    return this.ready.size;
  }

  /** Cached audio first (free), then new clips in order of need within the round's budget. */
  private async warmUp(key: string, names: Readonly<Record<string, string>>, mode: GameMode) {
    const { nameless, first, rest } = pixelpanikTexts(mode, names, () => this.rt.random());
    const all = [...nameless, ...first, ...rest];
    await this.each(all, async (text) => {
      if (this.key !== key) return;
      const clip = await this.rt.clip(text, false, async () => false);
      if (clip.path) this.ready.set(text, clip.path);
    });
    const before = this.ready.size;
    let generated = 0;
    if (this.key === key && this.rt.allowNew()) {
      await this.each(all, async (text) => {
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
      `pixelpanik voice: ${this.ready.size}/${all.length} lines ready (${before} cached, ${generated} new, ${this.spent} credits this round)`,
    );
  }

  private async reserve(credits: number): Promise<boolean> {
    if (this.spent + credits > PIXELPANIK_VOICE_CONFIG.maxNewCreditsPerRound) return false;
    // Booked before waiting – the parallel workers must not overshoot the cap together.
    this.spent += credits;
    if (await this.rt.reserveCredits(credits)) return true;
    this.spent -= credits;
    return false;
  }

  private async each(items: readonly string[], fn: (text: string) => Promise<void>) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) await fn(items[i++]!);
    };
    await Promise.all(Array.from({ length: PIXELPANIK_VOICE_CONFIG.parallel }, worker));
  }
}
