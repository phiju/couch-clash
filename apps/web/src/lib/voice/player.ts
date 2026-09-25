import type { HostLine } from "@couch-clash/shared";
import { VoiceQueue } from "./queue";

/** Short pause between two lines. */
const GAP_MS = 350;

export interface VoicePlayerDeps {
  /** Plays the audio; null → it can't be heard (audio locked, file failed) and is skipped. */
  play(line: HostLine): Promise<{ durationMs: number; ended: Promise<void> } | null>;
  /** Line started (server time when it will end) / ended. */
  report(event: { lineId: string; event: "started"; endsAt: number } | { lineId: string; event: "ended" }): void;
  /** The line currently heard (null = silent) – the mascot bounces while set. */
  onCurrent(line: HostLine | null): void;
  /** Server time (Date.now() + clock offset). */
  serverNow(): number;
  /** Fades the playing line out quickly (a more important one preempts it); its `ended` then resolves. */
  interrupt?(): void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Plays the host's lines one after another on the host screen – never
 * overlapping. There are no subtitles: a line that can't be played is
 * skipped. Framework-free so it can be tested without a browser.
 */
export class VoicePlayer {
  private readonly queue = new VoiceQueue();
  private stopped = false;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: VoicePlayerDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  enqueue(line: HostLine) {
    if (this.stopped) return;
    const interrupt = this.queue.shouldInterrupt(line);
    this.queue.enqueue(line, Date.now());
    if (interrupt) this.deps.interrupt?.();
    void this.pump();
  }

  stop() {
    this.stopped = true;
    this.queue.clear();
  }

  private async pump() {
    const line = this.queue.next(Date.now());
    if (!line) return;
    // E.g. "PLATSCH!" waits for the splash – never longer than the line may wait anyway.
    const wait = line.playAt !== undefined ? Math.min(line.playAt - this.deps.serverNow(), line.staleAfterMs ?? 3_000) : 0;
    if (wait > 0) await this.sleep(wait);
    const played = this.stopped ? null : await this.deps.play(line);
    if (played && !this.stopped) {
      this.deps.onCurrent(line);
      this.deps.report({ lineId: line.id, event: "started", endsAt: this.deps.serverNow() + played.durationMs });
      await played.ended;
      this.deps.onCurrent(null);
      await this.sleep(GAP_MS);
    }
    if (this.stopped) return;
    this.deps.report({ lineId: line.id, event: "ended" });
    this.queue.finish(line.id);
    void this.pump();
  }
}
