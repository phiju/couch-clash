import type { HostLine } from "@couch-clash/shared";

/**
 * Host screen playback queue: one line at a time, in order, never
 * overlapping. Time-critical lines (commentary) are dropped if they could
 * not start in time.
 */
export class VoiceQueue {
  private waiting: { line: HostLine; receivedAt: number }[] = [];
  private playing: HostLine | null = null;

  get current(): HostLine | null {
    return this.playing;
  }

  get length(): number {
    return this.waiting.length;
  }

  enqueue(line: HostLine, now: number) {
    if (this.playing?.id === line.id || this.waiting.some((w) => w.line.id === line.id)) return;
    this.waiting.push({ line, receivedAt: now });
  }

  /** The next line to play – null while one is playing or nothing waits. Drops stale lines. */
  next(now: number): HostLine | null {
    if (this.playing) return null;
    while (this.waiting.length > 0) {
      const { line, receivedAt } = this.waiting.shift()!;
      if (line.staleAfterMs !== null && now - receivedAt > line.staleAfterMs) continue;
      this.playing = line;
      return line;
    }
    return null;
  }

  /** The line finished (audio ended or skipped). */
  finish(id: string) {
    if (this.playing?.id === id) this.playing = null;
  }

  clear() {
    this.waiting = [];
    this.playing = null;
  }
}
