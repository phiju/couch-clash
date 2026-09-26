import { FIGURE_POSES, figureUrl } from "@couch-clash/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIGURE_CONFIG, FIGURE_PROMPTS, figurePrompt } from "../src/avatar/config";
import { acceptPhotoAndGenerate, runFigures, savePlayerPhoto, startPhotoUpload, useSavedPhoto, type RoomAccess } from "../src/avatar/jobs";
import {
  ROOM_MAX_FIGURE_IMAGES,
  FIGURES_STALE_MS,
  expireStalePhotos,
  nextPhotoDeadline,
  publicPhoto,
  startFigures,
} from "../src/avatar/photo-logic";
import { AvatarGenerationError, type AvatarImage } from "../src/avatar/provider";
import type { AvatarServiceDeps } from "../src/avatar/service";
import type { RoomRecord } from "../src/room-logic";
import { T0, memoryStore, mockProvider, photo, roomWithPlayers, styleReference } from "./avatar-helpers";

function access(initial: RoomRecord) {
  const a: RoomAccess & { room: RoomRecord } = {
    room: initial,
    read: () => a.room,
    commit: async (room) => {
      a.room = room;
    },
  };
  return a;
}

/** Every generated image gets its own bytes – so we can see which image was the input of which. */
function numberedProvider(fail: (prompt: string, attempt: number) => Error | null = () => null) {
  let n = 0;
  const attempts = new Map<string, number>();
  return mockProvider(async (_input, prompt) => {
    const attempt = (attempts.get(prompt) ?? 0) + 1;
    attempts.set(prompt, attempt);
    const err = fail(prompt, attempt);
    if (err) throw err;
    n++;
    return { bytes: new Uint8Array([n]), mimeType: "image/webp" } satisfies AvatarImage;
  });
}

async function acceptedPlayer(provider = numberedProvider()) {
  const store = memoryStore();
  const deps: AvatarServiceDeps = { provider, store, styleReference };
  const room = roomWithPlayers(["Ana"]);
  const p = room.players[0]!;
  const a = access(room);
  await (await startPhotoUpload(a, deps, { playerId: p.id, playerSecret: p.secret, photo }, T0)).job;
  const accepted = await acceptPhotoAndGenerate(a, deps, p.id, T0 + 1);
  if (!accepted.ok) throw new Error(accepted.error);
  return { a, p, store, provider, deps, done: accepted.value! };
}

const figureCalls = (provider: ReturnType<typeof mockProvider>) => provider.calls.filter((c) => c.options.transparent);
const poseOf = (prompt: string) =>
  prompt === FIGURE_PROMPTS.standard
    ? "standard"
    : (Object.entries(FIGURE_PROMPTS.expressions).find(([, text]) => prompt.endsWith(text))?.[0] ?? "?");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("standing figures: generation", () => {
  it("round avatar first and usable; then standard from the round avatar; then the 4 expressions from the standard figure", async () => {
    const { a, p, store, provider, done } = await acceptedPlayer();
    // The round avatar is there before any figure.
    expect(a.room.players[0]!.photo).toMatchObject({ status: "ready", accepted: true, figuresPending: true });
    await done;
    const photoRec = a.room.players[0]!.photo!;
    expect(photoRec.figures).toEqual(expect.arrayContaining([...FIGURE_POSES]));
    expect(photoRec.figuresPending).toBe(false);

    const figs = figureCalls(provider);
    expect(figs.map((c) => poseOf(c.prompt))).toEqual(["standard", ...figs.slice(1).map((c) => poseOf(c.prompt))]);
    expect(new Set(figs.slice(1).map((c) => poseOf(c.prompt)))).toEqual(new Set(["jubelnd", "besorgt", "panisch", "geschockt"]));
    // Input of "standard" = the round neutral avatar; input of every expression = the stored standard figure.
    const neutral = store.objects.get(`rooms/ABCD/${p.id}/neutral.webp`)!;
    const standard = store.objects.get(`rooms/ABCD/${p.id}/figure-standard.webp`)!;
    expect(figs[0]!.input.bytes).toEqual(neutral);
    for (const c of figs.slice(1)) expect(c.input.bytes).toEqual(standard);
    // Portrait, transparent, one fixed size for all five, no style reference (they keep the avatar's style).
    for (const c of figs) {
      expect(c.options).toMatchObject({ size: FIGURE_CONFIG.size, transparent: true });
      expect(c.withReference).toBe(false);
    }
    for (const pose of FIGURE_POSES) expect(store.objects.has(`rooms/ABCD/${p.id}/figure-${pose}.webp`)).toBe(true);
  });

  it("prompts come from the config file: standard as given, expressions = shared part + their text", () => {
    expect(figurePrompt("standard")).toBe(FIGURE_PROMPTS.standard);
    expect(figurePrompt("panisch")).toBe(`${FIGURE_PROMPTS.expressionBase}\n\n${FIGURE_PROMPTS.expressions.panisch}`);
    expect(FIGURE_PROMPTS.standard).toMatch(/^Turn this character into a full-body standing figure/);
  });

  it("API error on an expression: one automatic retry, then give up – the rest stays", async () => {
    const provider = numberedProvider((prompt) =>
      prompt.endsWith(FIGURE_PROMPTS.expressions.besorgt) ? new AvatarGenerationError("error", "OpenAI HTTP 500") : null,
    );
    const { a, done } = await acceptedPlayer(provider);
    await done;
    const besorgt = figureCalls(provider).filter((c) => poseOf(c.prompt) === "besorgt");
    expect(besorgt).toHaveLength(2);
    const rec = a.room.players[0]!.photo!;
    expect([...rec.figures!].sort()).toEqual(["geschockt", "jubelnd", "panisch", "standard"]);
    expect(rec.figuresPending).toBe(false);
    // 5 figures + 1 retry count against the room budget.
    expect(a.room.photoUsage.figures).toBe(6);
  });

  it("an API error that goes away on the retry still gives the figure", async () => {
    const provider = numberedProvider((prompt, attempt) =>
      prompt === FIGURE_PROMPTS.standard && attempt === 1 ? new AvatarGenerationError("error", "OpenAI HTTP 502") : null,
    );
    const { a, done } = await acceptedPlayer(provider);
    await done;
    expect(a.room.players[0]!.photo!.figures).toHaveLength(5);
  });

  it("standard figure fails → no expressions are attempted (they need it) – the round avatar stays", async () => {
    const provider = numberedProvider((prompt) => (prompt === FIGURE_PROMPTS.standard ? new AvatarGenerationError("error", "boom") : null));
    const { a, done } = await acceptedPlayer(provider);
    await done;
    const figs = figureCalls(provider);
    expect(figs.map((c) => poseOf(c.prompt))).toEqual(["standard", "standard"]);
    expect(a.room.players[0]!.photo).toMatchObject({ figures: [], figuresPending: false, status: "ready" });
  });

  it("a refusal is not retried", async () => {
    const provider = numberedProvider((prompt) =>
      prompt.endsWith(FIGURE_PROMPTS.expressions.geschockt) ? new AvatarGenerationError("refused", "moderation_blocked") : null,
    );
    const { done } = await acceptedPlayer(provider);
    await done;
    expect(figureCalls(provider).filter((c) => poseOf(c.prompt) === "geschockt")).toHaveLength(1);
  });

  it("logs counts and estimated cost", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { done } = await acceptedPlayer();
    await done;
    expect(log.mock.calls.flat().join(" ")).toContain(
      `avatar figures: 5/5 made in 5 model calls (≈$${(5 * FIGURE_CONFIG.estimatedUsdPerImage).toFixed(2)})`,
    );
  });

  it("a new round avatar drops the old figures; results for an old version are ignored", async () => {
    const { a, p, deps } = await acceptedPlayer();
    // Before the figures are done, the player makes a new round avatar (not possible while busy → reset path).
    const rec = a.room.players[0]!.photo!;
    a.room = { ...a.room, players: a.room.players.map((x) => (x.id === p.id ? { ...x, photo: { ...rec, readyVersion: 99, figuresPending: false } } : x)) };
    await runFigures(a, deps, "ABCD", p.id, T0 + 2);
    expect(a.room.players[0]!.photo!.readyVersion).toBe(99);
  });
});

describe("standing figures: state", () => {
  it("public state: which figures exist, and the fallback chain on top", async () => {
    const { a, p, done } = await acceptedPlayer();
    await done;
    const pub = publicPhoto(a.room.players[0]!, "ABCD")!;
    expect(pub.figures).toHaveLength(5);
    expect(figureUrl("", { ...pub, figures: ["standard"] }, "panisch")).toContain("figure-standard");
    expect(figureUrl("", { ...pub, figures: [] }, "panisch")).toBeNull();
    expect(p.id).toBeTruthy();
  });

  it("room budget: no new figure job once the model calls would exceed it", () => {
    let room = roomWithPlayers(["Ana"]);
    const p = room.players[0]!;
    room = {
      ...room,
      photoUsage: { base: 1, expressions: 0, figures: ROOM_MAX_FIGURE_IMAGES - 9 },
      players: room.players.map((x) => ({
        ...x,
        photo: {
          status: "ready" as const,
          version: 1,
          readyVersion: 1,
          accepted: true,
          expressions: ["neutral" as const],
          expressionsPending: false,
          startedAt: T0,
          reason: null,
        },
      })),
    };
    expect(startFigures(room, p.id, T0)).toBeNull();
    expect(startFigures({ ...room, photoUsage: { ...room.photoUsage, figures: ROOM_MAX_FIGURE_IMAGES - 10 } }, p.id, T0)).not.toBeNull();
  });

  it("a figure job that never reports back expires (the game never waits)", () => {
    let room = roomWithPlayers(["Ana"]);
    room = {
      ...room,
      players: room.players.map((x) => ({
        ...x,
        photo: {
          status: "ready" as const,
          version: 1,
          readyVersion: 1,
          accepted: true,
          expressions: ["neutral" as const],
          expressionsPending: false,
          startedAt: T0,
          reason: null,
          figures: ["standard" as const],
          figuresPending: true,
          figuresStartedAt: T0,
        },
      })),
    };
    expect(nextPhotoDeadline(room)).toBe(T0 + FIGURES_STALE_MS);
    expect(expireStalePhotos(room, T0 + FIGURES_STALE_MS - 1)).toBeNull();
    expect(expireStalePhotos(room, T0 + FIGURES_STALE_MS)!.players[0]!.photo).toMatchObject({ figuresPending: false, figures: ["standard"] });
  });
});

describe("standing figures: saved figures", () => {
  it("saved with the figures; loaded without any generation", async () => {
    const { a, p, store, provider, done } = await acceptedPlayer();
    await done;
    const SAVED = "0123456789abcdef0123456789abcdef";
    await savePlayerPhoto(a, store, p.id, T0 + 2, () => SAVED);
    const other = access(roomWithPlayers(["Ana"], "WXYZ"));
    const id = other.room.players[0]!.id;
    const calls = provider.calls.length;
    const used = await useSavedPhoto(other, store, id, SAVED, T0 + 3, { provider, store, styleReference });
    if (!used.ok) throw new Error(used.error);
    await used.value;
    expect(provider.calls.length).toBe(calls);
    expect(other.room.players[0]!.photo!.figures).toHaveLength(5);
  });

  it("a figure saved before standing figures existed gets them made on first use", async () => {
    const provider = numberedProvider();
    const store = memoryStore();
    const SAVED = "fedcba9876543210fedcba9876543210";
    store.objects.set(`saved/${SAVED}/neutral.webp`, new Uint8Array([1]));
    store.objects.set(
      `saved/${SAVED}/meta.json`,
      new TextEncoder().encode(JSON.stringify({ expressions: ["neutral"], savedAt: T0, lastUsedAt: T0 })),
    );
    const other = access(roomWithPlayers(["Ana"], "WXYZ"));
    const id = other.room.players[0]!.id;
    const used = await useSavedPhoto(other, store, id, SAVED, T0, { provider, store, styleReference });
    if (!used.ok) throw new Error(used.error);
    expect(other.room.players[0]!.photo).toMatchObject({ status: "ready", figuresPending: true });
    await used.value;
    expect(other.room.players[0]!.photo!.figures).toHaveLength(5);
    // …and they are kept in the saved slot for next time.
    const meta = JSON.parse(new TextDecoder().decode(store.objects.get(`saved/${SAVED}/meta.json`)!));
    expect([...meta.figures].sort()).toEqual([...FIGURE_POSES].sort());
  });
});
