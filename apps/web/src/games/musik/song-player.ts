"use client";

/**
 * Plays the Musik-Quiz's song previews on the host (TV). One instance per
 * tab. HTML audio elements (the provider previews come from other domains,
 * so no Web Audio decoding is needed – and no CORS):
 *
 * - `sync(target)` follows the server: play / pause at a clip position.
 *   Pausing keeps the exact spot; resuming continues from there (a seek only
 *   when the TV drifted more than MAX_DRIFT_MS from the server).
 * - `stop()` fades out briefly, never a hard cut.
 * - `preload(url)` loads the next clip while the current one plays.
 * - Loop mode (Kids): shortly before the end a second element starts at 0
 *   and they cross-fade – no gap, no click at the loop point.
 * - Volume = the host's master volume, lowered while the host speaks.
 *
 * Unlocked by the first host click (the audio engine's unlock also primes
 * audio elements).
 */
import { getAudioEngine } from "@/lib/audio/engine";

export interface SongTarget {
  url: string;
  playing: boolean;
  /** Clip position the server expects right now (ms). */
  positionMs: number;
  loop: boolean;
  /** Relative level (1 = normal; e.g. softer under the solution). */
  level?: number;
  /** False: play on freely from wherever it is (no drift correction), e.g. under the solution. */
  follow?: boolean;
}

export const SONG_PLAYER_CONFIG = {
  /** Songs sit a bit under the host's voice and the stings. */
  gain: 0.85,
  /** While the host speaks. */
  duckLevel: 0.35,
  fadeOutMs: 450,
  fadeInMs: 250,
  /** Resync only above this drift – a pause/resume stays exactly where it stopped. */
  maxDriftMs: 1_500,
  /** Loop cross-fade before the end of the clip. */
  loopCrossfadeMs: 1_200,
} as const;

function fade(el: HTMLAudioElement, to: number, ms: number, then?: () => void) {
  const from = el.volume;
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / Math.max(1, ms));
    el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
    else then?.();
  };
  requestAnimationFrame(step);
}

export class SongPlayer {
  private current: HTMLAudioElement | null = null;
  private outgoing: HTMLAudioElement | null = null;
  private url: string | null = null;
  private loop = false;
  private level = 1;
  private preloaded = new Map<string, HTMLAudioElement>();
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    const engine = getAudioEngine();
    // Volume slider and the host's voice change the song level.
    this.unsubscribe = engine.subscribe(() => this.applyVolume());
  }

  private target(): number {
    const engine = getAudioEngine();
    const duck = engine.speaking ? SONG_PLAYER_CONFIG.duckLevel : 1;
    return Math.min(1, engine.volume * SONG_PLAYER_CONFIG.gain * this.level * duck);
  }

  private applyVolume() {
    if (this.current && !this.current.paused) this.current.volume = this.target();
  }

  private element(url: string): HTMLAudioElement {
    const hit = this.preloaded.get(url);
    if (hit) {
      this.preloaded.delete(url);
      return hit;
    }
    const el = new Audio(url);
    el.preload = "auto";
    return el;
  }

  preload(url: string | null) {
    if (!url || url === this.url || this.preloaded.has(url) || typeof Audio === "undefined") return;
    const el = new Audio(url);
    el.preload = "auto";
    el.load();
    this.preloaded.set(url, el);
    // Only the next clip or two.
    while (this.preloaded.size > 2) {
      const oldest = this.preloaded.keys().next().value!;
      this.preloaded.get(oldest)?.removeAttribute("src");
      this.preloaded.delete(oldest);
    }
  }

  /** Follow the server's clip state. */
  sync(t: SongTarget) {
    if (typeof Audio === "undefined") return;
    this.level = t.level ?? 1;
    if (t.url !== this.url) {
      this.stop(SONG_PLAYER_CONFIG.fadeOutMs);
      this.url = t.url;
      this.current = this.element(t.url);
      this.current.volume = 0;
    }
    this.loop = t.loop;
    const el = this.current!;
    if (!t.playing) {
      if (!el.paused) el.pause();
      return;
    }
    const wanted = this.loop && el.duration > 0 ? (t.positionMs / 1000) % el.duration : t.positionMs / 1000;
    if (!this.loop && Number.isFinite(el.duration) && wanted >= el.duration) return;
    const drift = Math.abs(el.currentTime - wanted) * 1000;
    if (el.paused) {
      // Fresh start: at the server's position; after a pause: right where it stopped.
      if (el.currentTime === 0 || drift > SONG_PLAYER_CONFIG.maxDriftMs) el.currentTime = wanted;
      el.volume = 0;
      void el.play().then(
        () => fade(el, this.target(), SONG_PLAYER_CONFIG.fadeInMs),
        () => undefined,
      );
    } else if (!this.loop && t.follow !== false && drift > SONG_PLAYER_CONFIG.maxDriftMs) {
      el.currentTime = wanted;
    } else {
      el.volume = this.target();
    }
    this.watchLoop();
  }

  /** Kids: cross-fade into a second copy shortly before the end. */
  private watchLoop() {
    if (!this.loop) {
      if (this.loopTimer) clearInterval(this.loopTimer);
      this.loopTimer = null;
      return;
    }
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      const el = this.current;
      if (!el || el.paused || !this.url || !(el.duration > 0)) return;
      const left = (el.duration - el.currentTime) * 1000;
      if (left > SONG_PLAYER_CONFIG.loopCrossfadeMs) return;
      const next = new Audio(this.url);
      next.volume = 0;
      void next.play().then(() => fade(next, this.target(), SONG_PLAYER_CONFIG.loopCrossfadeMs), () => undefined);
      fade(el, 0, SONG_PLAYER_CONFIG.loopCrossfadeMs, () => {
        el.pause();
        el.removeAttribute("src");
      });
      this.current = next;
    }, 100);
  }

  /** Short fade-out, then silence (solution, next song, leaving the screen). */
  stop(fadeMs: number = SONG_PLAYER_CONFIG.fadeOutMs) {
    const el = this.current;
    this.current = null;
    this.url = null;
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
    if (!el) return;
    this.outgoing?.pause();
    this.outgoing = el;
    if (el.paused) {
      el.removeAttribute("src");
      return;
    }
    fade(el, 0, fadeMs, () => {
      el.pause();
      el.removeAttribute("src");
      if (this.outgoing === el) this.outgoing = null;
    });
  }

  dispose() {
    this.stop(0);
    this.unsubscribe?.();
    for (const el of this.preloaded.values()) el.removeAttribute("src");
    this.preloaded.clear();
  }
}

let player: SongPlayer | null = null;

/** The one song player of this tab. */
export function getSongPlayer(): SongPlayer {
  player ??= new SongPlayer();
  return player;
}
