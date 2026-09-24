/**
 * Music and sound only ever play on the host device.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const SRC = join(__dirname, "../src");
const PLAYER_CODE = [
  ...files(join(SRC, "app/join")),
  ...files(join(SRC, "components/player")),
  ...files(join(SRC, "games")).filter((f) => f.endsWith("player-view.tsx")),
];

describe("no audio on player phones", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("player code never touches the audio engine", () => {
    expect(PLAYER_CODE.length).toBeGreaterThan(3);
    for (const file of PLAYER_CODE) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/lib\/audio\/(engine|react)|getAudioEngine|SoundControls|AudioDirector|\.unlock\(/);
    }
  });

  it("the engine creates no AudioContext and plays nothing until unlock()", async () => {
    const created = vi.fn();
    vi.stubGlobal("window", {
      AudioContext: class {
        constructor() {
          created();
        }
      },
      localStorage: { getItem: () => null, setItem: () => {} },
    });
    vi.resetModules();
    const { getAudioEngine } = await import("../src/lib/audio/engine");
    const engine = getAudioEngine();
    engine.playMusic("lobby");
    await engine.playEffect("sting");
    await engine.playTitleJingle();
    engine.applyScene({ key: "lobby", music: "lobby" });
    expect(engine.unlocked).toBe(false);
    expect(created).not.toHaveBeenCalled();
  });
});
