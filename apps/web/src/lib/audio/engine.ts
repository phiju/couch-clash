"use client";

/**
 * The host's audio engine (Web Audio API). One instance per browser tab,
 * shared across client-side navigation (start page → host screen).
 *
 * Nothing happens until `unlock()` is called from a user gesture – only
 * host screens do that, so player phones stay silent.
 *
 *   sources → music bus (0.6) → duck → bed duck ─────────┐
 *   sources → effects bus (1.0) ──────────────────────────┤
 *   game loops → loops bus → bed duck ─┐                  │
 *   game one-shots ────────────────────┴→ sound bus (1.6) → duck ─┤  (Survival-Finale; lowered a little while the host speaks)
 *   host voice → voice bus (1.8) ──────────┴→ master (volume slider) → limiter → speakers
 */
import { sequenceSchedule } from "../voice/sequence";
import { loopPoints, parseAudioManifest, AUDIO_BASE, type AudioEntry } from "./manifest";
import {
  EFFECT_IDS,
  MUSIC_IDS,
  SOUND_IDS,
  SOUND_LEVELS,
  type AudioId,
  type AudioScene,
  type EffectId,
  type MusicId,
  type SoundId,
  type SurvivalLoopId,
  type SurvivalOneShotId,
} from "./scenes";

/** Background music is a bed under everything else. */
const MUSIC_GAIN = 0.6;
const EFFECTS_GAIN = 1.0;
/** The host's voice is clearly louder than the (ducked) music. */
const VOICE_GAIN = 1.8;
const DUCK_LEVEL = 0.3;
/**
 * Game sounds all play at the same base level (the files are balanced). They
 * must cut through the running music and sit just under the host's voice –
 * at 1.0 (music level) and 0.35 while he speaks (he comments on the very
 * events that trigger them), they were buried and nobody heard them.
 */
const SOUNDS_GAIN = 1.6;
const SOUNDS_DUCK_LEVEL = 0.7;
/** While a game one-shot plays, the background (music + game loops) steps back to this level. */
const BED_DUCK_LEVEL = 0.4;
const DEFAULT_FADE = 0.8;
const VOLUME_KEY = "couchclash:volume";
/** 50 ms of silence (WAV) – played once inside the unlocking click. */
const SILENT_WAV = `data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA`;

type Listener = () => void;

interface PlayingMusic {
  id: MusicId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface MusicRequest {
  id: MusicId | null;
  level: number;
  fade: number;
}

function readVolume(): number {
  try {
    const v = Number(window.localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && window.localStorage.getItem(VOLUME_KEY) !== null ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private duck!: GainNode;
  private effectsBus!: GainNode;
  private voiceBus!: GainNode;
  private soundsBus!: GainNode;
  private soundsDuck!: GainNode;
  /** Background under game one-shots: music and the game loops. */
  private musicBedDuck!: GainNode;
  private loopsBedDuck!: GainNode;
  /** Game one-shots playing right now (the background ducks while > 0). */
  private soundShots = 0;
  /** Game-sound loops by id, and the level each one should have (0 = off). */
  private loops = new Map<SurvivalLoopId, { source: AudioBufferSourceNode; gain: GainNode }>();
  private loopLevels = new Map<SurvivalLoopId, number>();
  /** Voice lines playing right now (the game sounds duck while > 0). */
  private voices = 0;
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceElement: HTMLAudioElement | null = null;
  /** Clips scheduled back to back (name clip + line). */
  private voiceSequence: AudioBufferSourceNode[] = [];

  private manifest: Record<AudioId, AudioEntry> | null = null;
  private buffers = new Map<AudioId, AudioBuffer>();
  private loading = new Map<AudioId, Promise<AudioBuffer | null>>();

  private music: PlayingMusic | null = null;
  private wanted: MusicRequest = { id: null, level: 1, fade: DEFAULT_FADE };
  private oneShots = 0;
  /** While the title jingle plays, music requests wait until this time (ctx seconds). */
  private holdMusicUntil = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private sceneKey: string | null = null;
  private sceneToken = 0;

  private listeners = new Set<Listener>();
  private _volume = typeof window === "undefined" ? 0.8 : readVolume();

  // ── state for React ───────────────────────────────────────────────────
  get unlocked(): boolean {
    return this.ctx !== null;
  }
  get volume(): number {
    return this._volume;
  }
  /** The host is speaking (categories with their own audio, e.g. the Musik-Quiz, lower it). */
  get speaking(): boolean {
    return this.voices > 0;
  }
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit() {
    for (const l of this.listeners) l();
  }

  // ── setup ─────────────────────────────────────────────────────────────
  /** Must be called from a click/tap. Creates the AudioContext and starts preloading. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._volume;
      // Safety limiter: loud sounds on top of the voice must never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC_GAIN;
      this.duck = ctx.createGain();
      this.musicBedDuck = ctx.createGain();
      this.musicBus.connect(this.duck).connect(this.musicBedDuck).connect(this.master);
      this.effectsBus = ctx.createGain();
      this.effectsBus.gain.value = EFFECTS_GAIN;
      this.effectsBus.connect(this.master);
      this.voiceBus = ctx.createGain();
      this.voiceBus.gain.value = VOICE_GAIN;
      this.voiceBus.connect(this.master);
      this.soundsBus = ctx.createGain();
      this.soundsBus.gain.value = SOUNDS_GAIN;
      this.soundsDuck = ctx.createGain();
      this.soundsBus.connect(this.soundsDuck).connect(this.master);
      this.loopsBedDuck = ctx.createGain();
      this.loopsBedDuck.connect(this.soundsBus);
      // A silent buffer "unlocks" playback on iOS/Safari.
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, 22050);
      silent.connect(ctx.destination);
      silent.start();
      // Audio elements (Musik-Quiz previews from other domains) need their own unlock inside the click.
      void new Audio(SILENT_WAV).play().catch(() => undefined);
      document.addEventListener("visibilitychange", this.onVisibility);
      void this.preload();
      this.emit();
    }
    void this.ctx.resume();
  }

  private onVisibility = () => {
    if (!this.ctx) return;
    if (document.visibilityState === "hidden") void this.ctx.suspend();
    else void this.ctx.resume();
  };

  setVolume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    try {
      window.localStorage.setItem(VOLUME_KEY, String(this._volume));
    } catch {
      // not remembered – fine
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05);
    this.emit();
  }

  private async loadManifest() {
    if (this.manifest) return this.manifest;
    let raw: unknown = null;
    try {
      const res = await fetch(`${AUDIO_BASE}audio.json`);
      if (res.ok) raw = await res.json();
    } catch {
      // defaults below
    }
    this.manifest = parseAudioManifest(raw);
    return this.manifest;
  }

  /** Fetch + decode everything; buffers stay in memory. */
  private async preload() {
    await this.loadManifest();
    // Jingle first (it plays right away), then the loops, then the rest.
    // Game sounds last: the Survival-Finale's are ready long before it starts.
    const order: AudioId[] = ["jingle", "lobby", ...MUSIC_IDS, ...EFFECT_IDS, ...SOUND_IDS];
    for (const id of [...new Set(order)]) void this.load(id);
  }

  private load(id: AudioId): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(id);
    if (!p) {
      p = (async () => {
        const ctx = this.ctx;
        if (!ctx) return null;
        const manifest = await this.loadManifest();
        try {
          const res = await fetch(manifest[id].url);
          if (!res.ok) return null;
          const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, buffer);
          if (this.wanted.id === id) this.applyMusic();
          return buffer;
        } catch {
          return null; // a missing file must never break the game
        }
      })();
      this.loading.set(id, p);
    }
    return p;
  }

  // ── music ─────────────────────────────────────────────────────────────
  /** Request a background loop (or silence). Only one loop plays at a time. */
  playMusic(id: MusicId | null, opts: { level?: number; fade?: number } = {}) {
    this.wanted = { id, level: opts.level ?? 1, fade: opts.fade ?? DEFAULT_FADE };
    this.applyMusic();
  }

  private applyMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { id, level, fade } = this.wanted;

    // Title jingle still running: start the loop only at its cue point.
    if (id && ctx.currentTime < this.holdMusicUntil) {
      if (!this.holdTimer) {
        this.holdTimer = setTimeout(() => {
          this.holdTimer = null;
          this.applyMusic();
        }, (this.holdMusicUntil - ctx.currentTime) * 1000 + 20);
      }
      return;
    }

    const now = ctx.currentTime;
    if (this.music && this.music.id === id) {
      this.music.gain.gain.cancelScheduledValues(now);
      this.music.gain.gain.setValueAtTime(this.music.gain.gain.value, now);
      this.music.gain.gain.linearRampToValueAtTime(level, now + fade);
      return;
    }
    // Fade out whatever is playing.
    if (this.music) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.source.stop(now + fade + 0.05);
      this.music = null;
    }
    if (!id) return;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.load(id); // applyMusic runs again when it is decoded
      return;
    }
    const entry = this.manifest![id];
    const { start, end } = loopPoints(entry, buffer.duration);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = end;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + fade);
    const trackGain = ctx.createGain();
    trackGain.gain.value = entry.gain;
    source.connect(trackGain).connect(gain).connect(this.musicBus);
    source.start(now); // plays the lead-in once, then loops between loopStart/loopEnd
    this.music = { id, source, gain };
  }

  // ── one-shots ─────────────────────────────────────────────────────────
  /** Plays over the music, which is ducked meanwhile. Resolves when finished. */
  async playEffect(id: EffectId): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = await this.load(id);
    if (!buffer || this.ctx !== ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const trackGain = ctx.createGain();
    trackGain.gain.value = this.manifest?.[id].gain ?? 1;
    source.connect(trackGain).connect(this.effectsBus);
    this.setDuck(true);
    this.oneShots++;
    source.start();
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
    this.oneShots = Math.max(0, this.oneShots - 1);
    if (this.oneShots === 0) this.setDuck(false);
  }

  /**
   * A spoken line of the host mascot (generated mp3). The music is ducked
   * while he speaks. Resolves once playback started (with its duration);
   * `ended` resolves when he is done. Null if audio is locked or the file
   * can't be played – the line is then skipped.
   *
   * `playbackRate` > 1 ("turbo") plays through an <audio> element with
   * preservesPitch, routed into the voice bus; 1 uses a decoded buffer.
   */
  async playVoice(url: string, playbackRate = 1): Promise<{ durationMs: number; ended: Promise<void> } | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (playbackRate !== 1) {
      const fast = await this.playVoiceElement(ctx, url, playbackRate);
      if (fast) return fast;
      // <audio> refused (autoplay policy, CORS) → normal speed below.
    }
    let buffer: AudioBuffer;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
    if (this.ctx !== ctx) return null;
    this.stopVoice();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceBus);
    this.voiceSource = source;
    const ended = this.voiceStarted(() => {
      if (this.voiceSource === source) this.voiceSource = null;
    });
    source.onended = ended.done;
    source.start();
    return { durationMs: Math.round(buffer.duration * 1000), ended: ended.promise };
  }

  /**
   * Several clips seamlessly one after another (the player's name clip, a
   * short gap, the line) – all decoded first, then scheduled on the audio
   * clock, so there is no loading pause in between. A missing name clip is
   * skipped; without the line nothing plays.
   */
  async playVoiceSequence(
    urls: readonly string[],
    gapMs: number,
    playbackRate = 1,
  ): Promise<{ durationMs: number; ended: Promise<void> } | null> {
    if (urls.length <= 1) return urls[0] ? this.playVoice(urls[0], playbackRate) : null;
    const ctx = this.ctx;
    if (!ctx) return null;
    const decoded = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url);
          return res.ok ? await ctx.decodeAudioData(await res.arrayBuffer()) : null;
        } catch {
          return null;
        }
      }),
    );
    if (!decoded.at(-1)) return null;
    const buffers = decoded.filter((b): b is AudioBuffer => b !== null);
    if (this.ctx !== ctx) return null;
    this.stopVoice();
    const { offsets, totalMs } = sequenceSchedule(buffers.map((b) => b.duration), gapMs, playbackRate);
    const t0 = ctx.currentTime + 0.02;
    const sources = buffers.map((buffer, i) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      source.connect(this.voiceBus);
      source.start(t0 + offsets[i]!);
      return source;
    });
    this.voiceSequence = sources;
    const ended = this.voiceStarted(() => {
      if (this.voiceSequence === sources) this.voiceSequence = [];
    });
    sources.at(-1)!.onended = ended.done;
    return { durationMs: totalMs, ended: ended.promise };
  }

  private async playVoiceElement(
    ctx: AudioContext,
    url: string,
    rate: number,
  ): Promise<{ durationMs: number; ended: Promise<void> } | null> {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.preservesPitch = true;
    el.src = url;
    let ended: { promise: Promise<void>; done: () => void } | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        el.addEventListener("loadedmetadata", () => resolve(), { once: true });
        el.addEventListener("error", () => reject(new Error("load")), { once: true });
      });
      const node = ctx.createMediaElementSource(el);
      node.connect(this.voiceBus);
      el.playbackRate = rate;
      this.stopVoice();
      this.voiceElement = el;
      const started = this.voiceStarted(() => {
        node.disconnect();
        if (this.voiceElement === el) this.voiceElement = null;
      });
      ended = started;
      el.addEventListener("ended", started.done, { once: true });
      el.addEventListener("error", started.done, { once: true });
      await el.play();
      return { durationMs: Math.round((el.duration / rate) * 1000), ended: started.promise };
    } catch {
      // play() refused after the ducking started: release it, or music and game sounds stay lowered for good.
      ended?.done();
      el.removeAttribute("src");
      return null;
    }
  }

  /** Ducks the music until `done` is called. */
  private voiceStarted(cleanup: () => void): { promise: Promise<void>; done: () => void } {
    this.setDuck(true);
    this.oneShots++;
    this.voices++;
    this.setSoundsDuck(true);
    this.emit();
    let finished = false;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    const done = () => {
      if (finished) return;
      finished = true;
      cleanup();
      this.oneShots = Math.max(0, this.oneShots - 1);
      if (this.oneShots === 0) this.setDuck(false);
      this.voices = Math.max(0, this.voices - 1);
      if (this.voices === 0) this.setSoundsDuck(false);
      this.emit();
      resolve();
    };
    return { promise, done };
  }

  /**
   * Fades the host out quickly (a more important line preempts him) – no
   * hard cut. The line's `ended` resolves when the fade is done.
   */
  fadeOutVoice(ms = 250) {
    const ctx = this.ctx;
    if (!ctx) return this.stopVoice();
    const g = this.voiceBus.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + ms / 1000);
    setTimeout(() => {
      this.stopVoice();
      const t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(VOICE_GAIN, t);
    }, ms);
  }

  /** Cuts the host off (e.g. when leaving the host screen). */
  stopVoice() {
    try {
      this.voiceSource?.stop();
    } catch {
      // already stopped
    }
    this.voiceSource = null;
    const sequence = this.voiceSequence;
    this.voiceSequence = [];
    for (const source of sequence) {
      try {
        source.stop();
      } catch {
        // not started / already stopped
      }
    }
    // A stopped sequence must still end (the last clip's onended resolves it).
    if (sequence.length) sequence.at(-1)!.onended?.(new Event("ended"));
    if (this.voiceElement) {
      this.voiceElement.pause();
      this.voiceElement.dispatchEvent(new Event("ended"));
      this.voiceElement = null;
    }
  }

  private setSoundsDuck(on: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.soundsDuck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? SOUNDS_DUCK_LEVEL : 1, now + (on ? 0.2 : 0.6));
  }

  // ── game sounds (Survival-Finale) ─────────────────────────────────────
  /** Loads game sounds ahead of time (a tick that arrives late is worse than none). */
  preloadSounds(ids: readonly SoundId[]) {
    if (!this.ctx) return;
    for (const id of ids) void this.load(id);
  }

  /**
   * A game sound, once, at its level from SOUND_LEVELS (× `volume` for a
   * quieter cue, e.g. the stop clack). While it plays, the background (music + game loops) is lowered so it cuts
   * through. `delayMs` schedules it (e.g. the splash on the impact). A
   * sound that isn't loaded yet plays only if it is ready within `maxLateMs`
   * – the game never waits for audio, and a late tick is worse than none.
   */
  playSound(id: SurvivalOneShotId, delayMs = 0, maxLateMs = 0, volume = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = (buffer: AudioBuffer, delay: number) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = (SOUND_LEVELS[id] ?? 1) * volume;
      source.connect(gain).connect(this.soundsBus);
      const wait = Math.max(0, delay);
      source.start(ctx.currentTime + wait / 1000);
      setTimeout(() => {
        if (this.ctx !== ctx) return;
        this.soundShots++;
        this.setBedDuck(true);
      }, wait);
      source.onended = () => {
        this.soundShots = Math.max(0, this.soundShots - 1);
        if (this.soundShots === 0) this.setBedDuck(false);
      };
    };
    const buffer = this.buffers.get(id);
    if (buffer) return start(buffer, delayMs);
    const asked = performance.now();
    void this.load(id).then((b) => {
      const late = performance.now() - asked;
      if (b && this.ctx === ctx && late <= delayMs + maxLateMs) start(b, delayMs - late);
    });
  }

  /**
   * A seamless WAV loop (Web Audio, loop = true over the whole file) at
   * `level` (0 = off, faded). Starts once the file is decoded.
   */
  setLoop(id: SurvivalLoopId, level: number, fade = 0.6) {
    this.loopLevels.set(id, Math.max(0, level) * (SOUND_LEVELS[id] ?? 1));
    this.applyLoop(id, fade);
  }

  /** All game-sound loops off (e.g. the finale is over). */
  stopLoops(fade = 0.6) {
    for (const id of [...this.loopLevels.keys()]) this.setLoop(id, 0, fade);
  }

  private applyLoop(id: SurvivalLoopId, fade: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const level = this.loopLevels.get(id) ?? 0;
    const now = ctx.currentTime;
    const playing = this.loops.get(id);
    if (playing) {
      const g = playing.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(level, now + fade);
      if (level === 0) {
        playing.source.stop(now + fade + 0.05);
        this.loops.delete(id);
      }
      return;
    }
    if (level === 0) return;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.load(id).then((b) => b && this.applyLoop(id, fade));
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true; // the files are cut seamlessly: loop the whole buffer
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + fade);
    source.connect(gain).connect(this.loopsBedDuck);
    source.start(now);
    this.loops.set(id, { source, gain });
  }

  /** Music and game loops step back under a game one-shot (quick down, gentle back up). */
  private setBedDuck(on: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const g of [this.musicBedDuck.gain, this.loopsBedDuck.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(on ? BED_DUCK_LEVEL : 1, now + (on ? 0.05 : 0.5));
    }
  }

  private setDuck(on: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? DUCK_LEVEL : 1, now + (on ? 0.2 : 0.6));
  }

  /**
   * Start page: title jingle, then the lobby loop fades in ~1.5 s before
   * the jingle ends (crossfade over ~2 s).
   */
  async playTitleJingle(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = await this.load("jingle");
    if (!buffer) {
      this.playMusic("lobby", { fade: 2 });
      return;
    }
    const cue = ctx.currentTime + Math.max(0, buffer.duration - 1.5);
    this.holdMusicUntil = cue;
    if (!this.wanted.id) this.wanted = { id: "lobby", level: 1, fade: 2 };
    else this.wanted = { ...this.wanted, fade: 2 };
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.effectsBus);
    source.start();
    this.applyMusic(); // schedules the lobby loop at the cue
  }

  // ── scenes (driven by the room phase) ─────────────────────────────────
  applyScene(scene: AudioScene | null) {
    if (!scene || !this.ctx || scene.key === this.sceneKey) return;
    this.sceneKey = scene.key;
    const token = ++this.sceneToken;
    this.playMusic(scene.music, { level: scene.musicLevel, fade: scene.musicFade });
    if (scene.enter) {
      void this.playEffect(scene.enter).then(() => {
        if (scene.afterEnter && token === this.sceneToken) {
          const a = scene.afterEnter;
          this.playMusic(a.music, { level: a.musicLevel, fade: a.musicFade });
        }
      });
    }
  }

  // ── sound test (developer mode) ───────────────────────────────────────
  /** Loads one file: its duration, or null if it is missing (404) or can't be decoded. */
  async probe(id: AudioId): Promise<number | null> {
    const buffer = await this.load(id);
    return buffer ? buffer.duration : null;
  }

  /** The URL a sound is loaded from (after audio.json). */
  async urlOf(id: AudioId): Promise<string> {
    return (await this.loadManifest())[id].url;
  }

  /** How loud the game sounds are right now (1 = normal, less while the host speaks). */
  get soundsDuckLevel(): number {
    return this.ctx ? this.soundsDuck.gain.value : 1;
  }

  /** For categories that play their own audio (music rounds, karaoke). */
  get context(): AudioContext | null {
    return this.ctx;
  }
  get effectsOutput(): AudioNode | null {
    return this.ctx ? this.effectsBus : null;
  }
}

let engine: AudioEngine | null = null;

/** The one engine of this tab (created lazily, inert until unlock()). */
export function getAudioEngine(): AudioEngine {
  engine ??= new AudioEngine();
  return engine;
}
