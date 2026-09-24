import { describe, expect, it } from "vitest";
import { PHOTO_EXPRESSIONS, expressionForChange, photoAvatarUrl, type PublicPhotoAvatar } from "../src";

const all = PHOTO_EXPRESSIONS;

describe("expressionForChange", () => {
  it("cheers when moving up, is disappointed when moving down", () => {
    expect(expressionForChange({ rankBefore: 3, rankAfter: 1, pointsGained: 100 }, all)).toBe("jubelnd");
    expect(expressionForChange({ rankBefore: 1, rankAfter: 2, pointsGained: 0 }, all)).toBe("enttaeuscht");
    expect(expressionForChange({ rankBefore: 2, rankAfter: 2, pointsGained: 50 }, all)).toBe("neutral");
  });

  it("is shocked by a big loss", () => {
    expect(expressionForChange({ rankBefore: 1, rankAfter: 4, pointsGained: 0 }, all)).toBe("geschockt");
    expect(expressionForChange({ rankBefore: 1, rankAfter: 1, pointsGained: -200 }, all)).toBe("geschockt");
  });

  it("falls back to neutral when the expression does not exist (yet)", () => {
    expect(expressionForChange({ rankBefore: 3, rankAfter: 1, pointsGained: 100 }, ["neutral"])).toBe("neutral");
  });
});

describe("photoAvatarUrl", () => {
  const photo: PublicPhotoAvatar = {
    status: "ready",
    version: 2,
    readyVersion: 2,
    accepted: true,
    expressions: ["neutral", "jubelnd"],
    regenerationsLeft: 1,
    reason: null,
    path: "/api/rooms/ABCD/avatar/p1",
    saved: false,
  };

  it("builds a cache-busting URL and falls back to neutral", () => {
    expect(photoAvatarUrl("https://x.dev", photo, "jubelnd")).toBe("https://x.dev/api/rooms/ABCD/avatar/p1/jubelnd?v=2");
    expect(photoAvatarUrl("https://x.dev", photo, "geschockt")).toBe("https://x.dev/api/rooms/ABCD/avatar/p1/neutral?v=2");
  });

  it("returns null (emoji) without a ready image", () => {
    expect(photoAvatarUrl("https://x.dev", undefined)).toBeNull();
    expect(photoAvatarUrl("https://x.dev", { ...photo, status: "pending", readyVersion: null })).toBeNull();
  });
});

describe("saved figure messages", () => {
  it("accepts only well-formed saved ids", async () => {
    const { ClientMessageSchema } = await import("../src");
    const avatar = { character: "fox", color: "red" };
    const ok = "0123456789abcdef0123456789abcdef";
    expect(ClientMessageSchema.safeParse({ type: "join", name: "Ana", avatar, savedFigureId: ok }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "join", name: "Ana", avatar }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "photo_use_saved", savedId: "../rooms/x" }).success).toBe(false);
  });
});
