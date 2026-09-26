/**
 * The host's voice in the Musik-Quiz: announces the question type before
 * every song and comments cheekily on wrong buzzes, lightning-fast hits,
 * bullseye years and songs nobody knew – lines from musik-lines.ts with
 * cached audio (same approach as Pixelpanik).
 *
 * Audio is prepared in the background when a round starts: nameless lines
 * (the announcements first) once for all rooms, `{name}` lines per player
 * within a credit cap per round. Only lines whose audio is ready are picked
 * – nothing here ever delays the game. The TV lowers the song while he talks.
 */
import type { MusikEvent, MusikState } from "@couch-clash/games";
import type { GameMode, HostLine } from "@couch-clash/shared";
import { MUSIK_SITUATIONS, musikLinesFor, musikSituation, type MusikSituation } from "./musik-lines";
import { NAME, fillName } from "./pixelpanik-lines";
import type { SurvivalVoiceRuntime } from "./survival-voice";

export const MUSIK_VOICE_CONFIG = {
  lockedPerSituation: 3,
  /** ElevenLabs credits a round may spend on NEW audio (on top of what is cached). */
  maxNewCreditsPerRound: 4_000,
  /** `{name}` lines voiced first per player and situation. */
  namedFirst: 2,
  parallel: 3,
  /** A line that can't start this soon after the event is dropped. */
  staleAfterMs: 2_500,
  /** The announcement must come while the question type is on the TV. */
  announceStaleAfterMs: 1_500,
  minGapMs: 2_000,
  maxEventAgeMs: 3_000,
} as const;

/** Lower = more important; announcements and the solution may interrupt the gap. */
const PRIORITY: Record<MusikSituation, number> = {
  announceTitle: 1,
  announceArtist: 1,
  announceYear: 1,
  announceKids: 1,
  nobody: 2,
  kidsAllRight: 2,
  yearBullseye: 2,
  fastCorrect: 3,
  partial: 3,
  wrong: 4,
  correct: 4,
  yearWayOff: 4,
};
const URGENT = new Set<MusikSituation>(["announceTitle", "announceArtist", "announceYear", "announceKids", "nobody", "kidsAllRight", "yearBullseye"]);

export interface MusikVoiceMemory {
  recent: Partial<Record<MusikSituation, string[]>>;
  lastSpokenAt: number | null;
}

export const createMusikMemory = (): MusikVoiceMemory => ({ recent: {}, lastSpokenAt: null });

export interface MusikPick {
  situation: MusikSituation;
  template: string;
  text: string;
  priority: number;
}

export interface MusikChooseInput {
  mode: GameMode;
  names: Readonly<Record<string, string>>;
  now: number;
  random: () => number;
  ready: (text: string) => boolean;
}

/** Pure: which line (if any) the host says about these new events. */
export function chooseMusikLine(
  events: readonly MusikEvent[],
  memory: MusikVoiceMemory,
  input: MusikChooseInput,
): { pick: MusikPick | null; memory: MusikVoiceMemory } {
  const fresh = events
    .filter((e) => input.now - e.at <= MUSIK_VOICE_CONFIG.maxEventAgeMs)
    .flatMap((e) => {
      const situation = musikSituation(e.type, e.questionType);
      return situation ? [{ event: e, situation }] : [];
    })
    .sort((a, b) => PRIORITY[a.situation] - PRIORITY[b.situation] || b.event.seq - a.event.seq);

  const busy = memory.lastSpokenAt !== null && input.now - memory.lastSpokenAt < MUSIK_VOICE_CONFIG.minGapMs;
  for (const { event, situation } of fresh) {
    if (busy && !URGENT.has(situation)) continue;
    const name = event.playerId ? input.names[event.playerId] : undefined;
    const locked = new Set(memory.recent[situation] ?? []);
    const options = musikLinesFor(situation, input.mode).filter((t) => !locked.has(t) && (name !== undefined || !t.includes(NAME)));
    const candidates = options.map((template) => ({ template, text: name ? fillName(template, name) : template })).filter((c) => input.ready(c.text));
    if (candidates.length === 0) continue;
    const chosen = candidates[Math.min(candidates.length - 1, Math.floor(input.random() * candidates.length))]!;
    const recent = [...(memory.recent[situation] ?? []), chosen.template].slice(-MUSIK_VOICE_CONFIG.lockedPerSituation);
    return {
      pick: { situation, template: chosen.template, text: chosen.text, priority: PRIORITY[situation] },
      memory: { recent: { ...memory.recent, [situation]: recent }, lastSpokenAt: input.now },
    };
  }
  return { pick: null, memory };
}

/** Every text a round may need: announcements, other nameless lines, then `{name}` lines per player. */
export function musikTexts(mode: GameMode, names: Readonly<Record<string, string>>) {
  const announce: string[] = [];
  const nameless: string[] = [];
  const first: string[] = [];
  const rest: string[] = [];
  for (const situation of MUSIK_SITUATIONS) {
    const lines = musikLinesFor(situation, mode);
    (situation.startsWith("announce") ? announce : nameless).push(...lines.filter((t) => !t.includes(NAME)));
    const named = lines.filter((t) => t.includes(NAME));
    for (const name of Object.values(names)) {
      first.push(...named.slice(0, MUSIK_VOICE_CONFIG.namedFirst).map((t) => fillName(t, name)));
      rest.push(...named.slice(MUSIK_VOICE_CONFIG.namedFirst).map((t) => fillName(t, name)));
    }
  }
  const unique = (xs: string[]) => [...new Set(xs)];
  return { announce: unique(announce), nameless: unique(nameless), first: unique(first), rest: unique(rest) };
}

export class MusikVoice {
  private key: string | null = null;
  private lastSeq = 0;
  private memory = createMusikMemory();
  private readonly ready = new Map<string, string>();
  private spent = 0;
  private stopped = false;

  constructor(private readonly rt: SurvivalVoiceRuntime) {}

  roomChanged(state: MusikState, names: Readonly<Record<string, string>>, mode: GameMode) {
    const maxSeq = state.events.at(-1)?.seq ?? 0;
    if (state.roundKey !== this.key) {
      this.key = state.roundKey;
      this.memory = createMusikMemory();
      this.spent = 0;
      this.stopped = false;
      this.lastSeq = maxSeq;
      if (this.rt.enabled()) this.rt.run(() => this.warmUp(state.roundKey, names, mode));
      return;
    }
    const events = state.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = Math.max(this.lastSeq, maxSeq);
    if (events.length === 0 || !this.rt.enabled()) return;
    const { pick, memory } = chooseMusikLine(events, this.memory, {
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
      staleAfterMs: pick.situation.startsWith("announce") ? MUSIK_VOICE_CONFIG.announceStaleAfterMs : MUSIK_VOICE_CONFIG.staleAfterMs,
      priority: pick.priority,
      preempt: pick.situation.startsWith("announce"),
    } satisfies HostLine);
  }

  get readyCount(): number {
    return this.ready.size;
  }

  /** Cached audio first (free), then new clips in order of need within the round's budget. */
  private async warmUp(key: string, names: Readonly<Record<string, string>>, mode: GameMode) {
    const { announce, nameless, first, rest } = musikTexts(mode, names);
    const all = [...announce, ...nameless, ...first, ...rest];
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
    this.rt.log(`musik voice: ${this.ready.size}/${all.length} lines ready (${before} cached, ${generated} new, ${this.spent} credits this round)`);
  }

  private async reserve(credits: number): Promise<boolean> {
    if (this.spent + credits > MUSIK_VOICE_CONFIG.maxNewCreditsPerRound) return false;
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
    await Promise.all(Array.from({ length: MUSIK_VOICE_CONFIG.parallel }, worker));
  }
}
