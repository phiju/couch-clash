import { afterEach, describe, expect, it, vi } from "vitest";
import { initialLobbySettingsOpen } from "../src/lib/lobby-panel";

describe("host lobby settings panel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts collapsed – player count and room code play no part", () => {
    expect(initialLobbySettingsOpen()).toBe(false);
  });

  it("ignores an old remembered 'open' state and starts collapsed in a new room", () => {
    const stored = new Map([["couchclash:lobby-settings-open", "true"]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => stored.get(k) ?? null } });
    expect(initialLobbySettingsOpen()).toBe(false);
    expect(initialLobbySettingsOpen()).toBe(false);
  });
});
