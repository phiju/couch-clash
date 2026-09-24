import type { PublicRoomState } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { audioSceneFor, questionRoundAudio } from "../src/lib/audio/scenes";

type Room = Pick<PublicRoomState, "phase" | "game">;
const game = (roundIndex = 0) =>
  ({ rounds: [], roundIndex, scores: {}, roundGain: {}, module: null, leaderboard: null }) as PublicRoomState["game"];
const room = (phase: PublicRoomState["phase"], roundIndex = 0): Room => ({
  phase,
  game: phase === "lobby" || phase === "setup" ? null : game(roundIndex),
});
const scene = (phase: PublicRoomState["phase"], step?: string, index = 0) =>
  audioSceneFor(room(phase), step ? questionRoundAudio({ step, index }) : null);

describe("phase → music mapping", () => {
  it("nothing before the room state is known", () => {
    expect(audioSceneFor(null)).toBeNull();
  });

  it("lobby and setup: lobby loop, same key so 'Nochmal spielen' does not restart it", () => {
    expect(scene("lobby")).toEqual({ key: "lobby", music: "lobby" });
    expect(scene("setup")).toEqual({ key: "lobby", music: "lobby" });
  });

  it("category intro: short sting over the (ducked) lobby loop", () => {
    expect(scene("intro")).toMatchObject({ music: "lobby", enter: "sting-short" });
    expect(audioSceneFor(room("intro", 0))!.key).not.toBe(audioSceneFor(room("intro", 1))!.key);
  });

  it("question open: think loop (crossfade)", () => {
    const s = scene("play", "question");
    expect(s).toMatchObject({ music: "think" });
    expect(s!.musicFade).toBeUndefined(); // default crossfade 0.8 s
  });

  it("reveal: think loop stops in 0.3 s, sting plays", () => {
    expect(scene("play", "reveal")).toMatchObject({ music: null, musicFade: 0.3, enter: "sting" });
  });

  it("leaderboard: lobby loop fades back in", () => {
    expect(scene("play", "leaderboard")).toMatchObject({ music: "lobby" });
  });

  it("every question and step gets its own key (effects retrigger)", () => {
    const keys = [
      scene("play", "question", 0),
      scene("play", "reveal", 0),
      scene("play", "leaderboard", 0),
      scene("play", "question", 1),
    ].map((s) => s!.key);
    expect(new Set(keys).size).toBe(4);
  });

  it("category scoreboard: sting + lobby loop", () => {
    expect(scene("scoreboard")).toMatchObject({ music: "lobby", enter: "sting" });
  });

  it("finale: loops stop, fanfare once, then a quiet lobby loop", () => {
    const s = scene("finale")!;
    expect(s).toMatchObject({ music: null, enter: "fanfare" });
    expect(s.afterEnter?.music).toBe("lobby");
    expect(s.afterEnter!.musicLevel!).toBeLessThan(1);
  });

  it("categories can request no background music", () => {
    const s = audioSceneFor(room("play"), { key: "song:1", music: null });
    expect(s).toMatchObject({ music: null });
    expect(s!.enter).toBeUndefined();
  });

  it("a category without its own mapping gets the lobby loop", () => {
    expect(audioSceneFor(room("play"), null)).toMatchObject({ music: "lobby" });
  });
});
