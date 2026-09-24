import type { HostLine } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { VoicePlayer } from "../src/lib/voice/player";
import { VoiceQueue } from "../src/lib/voice/queue";

const line = (id: string, over: Partial<HostLine> = {}): HostLine => ({
  id,
  kind: "welcome",
  text: `Applaus für ${id}!`,
  audioPath: `/api/rooms/ABCD/voice/${id}`,
  staleAfterMs: null,
  ...over,
});

describe("VoiceQueue", () => {
  it("plays one line at a time, in order", () => {
    const q = new VoiceQueue();
    q.enqueue(line("a"), 0);
    q.enqueue(line("b"), 0);
    expect(q.next(0)?.id).toBe("a");
    expect(q.next(0)).toBeNull(); // no overlap while "a" plays
    q.finish("b"); // wrong id changes nothing
    expect(q.next(0)).toBeNull();
    q.finish("a");
    expect(q.next(0)?.id).toBe("b");
  });

  it("drops commentary that could not start in time, ignores duplicates", () => {
    const q = new VoiceQueue();
    q.enqueue(line("a"), 0);
    q.enqueue(line("late", { kind: "comment", staleAfterMs: 2500 }), 0);
    q.enqueue(line("c"), 0);
    q.enqueue(line("c"), 0);
    expect(q.next(0)?.id).toBe("a");
    q.finish("a");
    expect(q.next(5000)?.id).toBe("c");
    q.finish("c");
    expect(q.next(5000)).toBeNull();
  });
});

describe("VoicePlayer", () => {
  function setup(play: (l: HostLine) => Promise<{ durationMs: number; ended: Promise<void> } | null>) {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const player = new VoicePlayer({
      play: async (l) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const r = await play(l);
        if (r) void r.ended.then(() => active--);
        else active--;
        return r;
      },
      report: (e) => log.push(`${e.event}:${e.lineId}${"endsAt" in e ? `@${e.endsAt}` : ""}`),
      onCurrent: (l) => log.push(`show:${l?.id ?? "-"}`),
      serverNow: () => 1000,
      sleep: () => Promise.resolve(),
    });
    return { player, log, maxActive: () => maxActive };
  }

  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };

  it("never overlaps lines and reports start/end", async () => {
    const { player, log, maxActive } = setup(async () => ({ durationMs: 2000, ended: Promise.resolve() }));
    player.enqueue(line("a"));
    player.enqueue(line("b"));
    await flush();
    expect(maxActive()).toBe(1);
    expect(log).toEqual([
      "show:a", "started:a@3000", "ended:a", "show:-",
      "show:b", "started:b@3000", "ended:b", "show:-",
    ]);
  });

  it("shows the subtitle for a reading time when there is no audio", async () => {
    const { player, log } = setup(async () => null);
    player.enqueue(line("a", { audioPath: null, text: "Kurz!" }));
    await flush();
    expect(log[0]).toBe("show:a");
    expect(log[1]).toBe("started:a@3500"); // 1000 + minimum reading time 2.5 s
  });

  it("stops cleanly", async () => {
    const { player, log } = setup(async () => ({ durationMs: 1, ended: Promise.resolve() }));
    player.stop();
    player.enqueue(line("a"));
    await flush();
    expect(log).toEqual([]);
  });
});
