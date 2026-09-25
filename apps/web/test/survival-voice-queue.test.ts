import type { HostLine } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { VoicePlayer } from "../src/lib/voice/player";
import { VoiceQueue } from "../src/lib/voice/queue";

const line = (id: string, over: Partial<HostLine> = {}): HostLine => ({
  id,
  kind: "comment",
  text: id,
  audioPath: `/api/voice-cache/x/snark/${id}.mp3`,
  playbackRate: 1,
  staleAfterMs: 2500,
  ...over,
});

describe("host voice queue: Survival-Finale commentary", () => {
  it("more important lines go first, equal ones keep their order; lines without priority stay FIFO", () => {
    const q = new VoiceQueue();
    q.enqueue(line("playing"), 0);
    expect(q.next(0)?.id).toBe("playing");
    q.enqueue(line("decay", { priority: 8 }), 0);
    q.enqueue(line("wrong", { priority: 5 }), 0);
    q.enqueue(line("fast", { priority: 9 }), 0);
    q.enqueue(line("out", { priority: 2 }), 0);
    q.enqueue(line("plain"), 0);
    q.finish("playing");
    const order: string[] = [];
    for (let l = q.next(0); l; l = q.next(0)) {
      order.push(l.id);
      q.finish(l.id);
    }
    expect(order).toEqual(["out", "wrong", "plain", "decay", "fast"]);
  });

  it("a queued comment expires after 2.5 s – a stale 'Minus zehn …' is worse than none", () => {
    const q = new VoiceQueue();
    q.enqueue(line("long", { staleAfterMs: null }), 0);
    q.next(0);
    q.enqueue(line("minus-ten", { priority: 8 }), 0);
    q.finish("long");
    expect(q.next(2_600)).toBeNull();
  });

  it("only a preempting, more important line interrupts", () => {
    const q = new VoiceQueue();
    q.enqueue(line("decay", { priority: 8 }), 0);
    q.next(0);
    expect(q.shouldInterrupt(line("wrong", { priority: 5 }))).toBe(false);
    expect(q.shouldInterrupt(line("out", { priority: 2, preempt: true }))).toBe(true);
    q.finish("decay");
    q.enqueue(line("winner", { priority: 1 }), 0);
    q.next(0);
    expect(q.shouldInterrupt(line("out", { priority: 2, preempt: true }))).toBe(false);
  });

  it("the player fades the running line out for a preempting one and plays it next; 'PLATSCH!' waits for the splash", async () => {
    const log: string[] = [];
    let endCurrent: (() => void) | null = null;
    const sleeps: number[] = [];
    const player = new VoicePlayer({
      play: async (l) => {
        log.push(`play:${l.id}`);
        const ended = new Promise<void>((r) => (endCurrent = r));
        return { durationMs: 3000, ended };
      },
      report: () => {},
      onCurrent: () => {},
      serverNow: () => 1_000,
      interrupt: () => {
        log.push("fade");
        endCurrent?.();
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const flush = async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    };
    player.enqueue(line("decay", { priority: 8 }));
    await flush();
    player.enqueue(line("platsch", { priority: 2, preempt: true, playAt: 2_350 }));
    await flush();
    expect(log).toEqual(["play:decay", "fade", "play:platsch"]);
    expect(sleeps).toContain(1_350);
  });

  it("the voice failing never blocks anything: unplayable lines are skipped", async () => {
    const ended: string[] = [];
    const player = new VoicePlayer({
      play: async () => null,
      report: (e) => {
        if (e.event === "ended") ended.push(e.lineId);
      },
      onCurrent: () => {},
      serverNow: () => 0,
      sleep: async () => {},
    });
    player.enqueue(line("a", { priority: 1 }));
    player.enqueue(line("b", { priority: 9 }));
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(ended).toEqual(["a", "b"]);
  });
});
