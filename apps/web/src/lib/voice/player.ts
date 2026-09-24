import { readingTimeMs, type HostLine } from "@couch-clash/shared";
import { VoiceQueue } from "./queue";

/** Short pause after a line so the subtitle doesn't vanish mid-word. */
const LINGER_MS = 400;

export interface VoicePlayerDeps {
  /** Plays the audio; null → subtitle only (audio locked, muted, file failed). */
  play(line: HostLine): Promise<{ durationMs: number; ended: Promise<void> } | null>;
  /** Line started (server time when it will end) / ended. */
  report(event: { lineId: string; event: "started"; endsAt: number } | { lineId: string; event: "ended" }): void;
  /** The line currently shown (null = silent). */
  onCurrent(line: HostLine | null): void;
  /** Server time (Date.now() + clock offset). */
  serverNow(): number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Plays the host's lines one after another on the host screen – never
 * overlapping. Framework-free so it can be tested without a browser.
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
    this.queue.enqueue(line, Date.now());
    void this.pump();
  }

  stop() {
    this.stopped = true;
    this.queue.clear();
  }

  private async pump() {
    const line = this.queue.next(Date.now());
    if (!line) return;
    this.deps.onCurrent(line);
    const played = await this.deps.play(line);
    const durationMs = played?.durationMs ?? readingTimeMs(line.text);
    this.deps.report({ lineId: line.id, event: "started", endsAt: this.deps.serverNow() + durationMs });
    await (played ? played.ended : this.sleep(durationMs));
    await this.sleep(LINGER_MS);
    if (this.stopped) return;
    this.deps.report({ lineId: line.id, event: "ended" });
    this.queue.finish(line.id);
    this.deps.onCurrent(null);
    void this.pump();
  }
}
