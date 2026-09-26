import type { HostLine } from "@couch-clash/shared";

/** Queue order when a line has no priority (lower = more important). */
export const DEFAULT_LINE_PRIORITY = 5;

export const priorityOf = (line: HostLine) => line.priority ?? DEFAULT_LINE_PRIORITY;

/**
 * Host screen playback queue: one line at a time, never overlapping. More
 * important lines (lower `priority`) go first, equal ones keep their order.
 * Time-critical lines (commentary) are dropped if they could not start in time.
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
    const at = this.waiting.findIndex((w) => priorityOf(w.line) > priorityOf(line));
    const entry = { line, receivedAt: now };
    if (at < 0) this.waiting.push(entry);
    else this.waiting.splice(at, 0, entry);
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

  /** A newly arrived line may cut the playing one short (it preempts and is more important). */
  shouldInterrupt(line: HostLine): boolean {
    return !!line.preempt && !!this.playing && priorityOf(line) < priorityOf(this.playing);
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
