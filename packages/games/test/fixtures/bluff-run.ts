/**
 * Golden master for the Bluff-Lexikon: plays full rounds with the real
 * content and a seeded random and records everything players, the host
 * screen, the voice and the stats see. The recording in bluff-golden.json
 * was made BEFORE the engine refactor – the Bluff-Lexikon must stay the same.
 */
import type { GameModule, GameModeSettings, ModuleContext, ModulePlayer, Viewer } from "@couch-clash/shared";
import { bluffMeta } from "../../src/bluff/meta";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = ["so ne art blasinstrument glaub ich", "wenn man zu viel gegessen hat und rülpst!!", "ein Werkzeug für Schuster", "Eimer"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = GameModule<any, any, any>;

export function recordBluffRun(mod: AnyModule, mode: GameModeSettings["mode"], seed: number) {
  const random = seeded(seed);
  const players: ModulePlayer[] = ["a", "b", "c", "d"].map((id) => ({ id, connected: true }));
  let now = 1_700_000_000_000;
  const ctx = (): ModuleContext => ({ now, players, random });
  const log: unknown[] = [];
  const viewers: Viewer[] = [{ role: "host" }, { role: "player", playerId: "a" }, { role: "player", playerId: "c" }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any;
  const snap = (label: string, extra: Record<string, unknown> = {}) => {
    log.push({
      label,
      ...extra,
      views: viewers.map((v) => mod.toPublicState(state, v)),
      readAloud: mod.readAloud?.(state) ?? null,
      task: mod.pendingTask?.(state) ?? null,
      facts: mod.revealFacts?.(state) ?? null,
      stats: mod.toStats?.(state) ?? null,
      progress: mod.progress?.(state) ?? null,
    });
  };
  const init = mod.init(ctx(), {
    questionCount: 4,
    scoring: bluffMeta.scoring,
    excludeContentIds: [],
    mode: { mode, allow16: false, difficulty: "mixed" },
  });
  state = init.state;
  snap("init", { usedContentIds: init.usedContentIds, done: init.done ?? false });
  for (let round = 0; round < 8 && !init.done; round++) {
    // a, b, c write; d stays silent.
    for (const [i, id] of ["a", "b", "c"].entries()) {
      now += 1000;
      const text = round % 2 === 0 ? TEXTS[i]! : TEXTS[(i + round) % TEXTS.length]!;
      const r = mod.handleAction(state, { type: "define", text }, id, ctx());
      if (!("error" in r)) state = r.state;
      else log.push({ error: r.error });
    }
    now += 60_000;
    state = mod.onTimer(state, ctx()).state;
    snap("after-write");
    const task = mod.pendingTask?.(state);
    if (task) {
      const reply =
        round === 1
          ? null
          : {
              results: [
                { id: "s1", verdict: "bluff", confidence: 0.9, reason: "x", polished: "Eine Art Blasinstrument", sameIdea: true, group: 1 },
                { id: "s2", verdict: round === 2 ? "correct" : "bluff", confidence: 0.8, reason: "y", polished: "Wenn jemand nach zu viel Essen aufstößt", sameIdea: true, group: 2 },
                { id: "s3", verdict: round === 3 ? "offensive" : "bluff", confidence: 0.9, reason: "z", polished: "Ein Werkzeug für Schuster!", sameIdea: true, group: 1 },
              ],
            };
      const u = mod.resolveTask!(state, task.id, reply, ctx());
      if (u) state = u.state;
    }
    snap("present");
    now += 20_000;
    state = mod.onTimer(state, ctx()).state;
    snap("vote");
    for (const id of ["a", "b", "c", "d"]) {
      const pub = mod.toPublicState(state, { role: "player", playerId: id });
      if (!pub.canVote || !pub.options) continue;
      const option = (pub.options as unknown[]).findIndex((_, i) => !pub.myOptions.includes(i) && (i + round + id.charCodeAt(0)) % 2 === 0);
      now += 500;
      const r = mod.handleAction(state, { type: "vote", option: option < 0 ? pub.options.length - 1 : option }, id, ctx());
      if (!("error" in r)) {
        state = r.state;
        if (r.scoreDelta) log.push({ scoreDelta: r.scoreDelta });
      } else log.push({ voteError: r.error });
    }
    if (state.step === "vote") {
      now += 30_000;
      const u = mod.onTimer(state, ctx());
      state = u.state;
      log.push({ scoreDelta: u.scoreDelta ?? null });
    }
    snap("reveal");
    now += 12_000;
    state = mod.onTimer(state, ctx()).state;
    snap("solution");
    now += 5_000;
    state = mod.onTimer(state, ctx()).state;
    snap("leaderboard");
    now += 5_000;
    const next = mod.onTimer(state, ctx());
    state = next.state;
    if (next.done) break;
  }
  return log;
}
