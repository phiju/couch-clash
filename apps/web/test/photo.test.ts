import type { PublicPlayer } from "@couch-clash/shared";
import { describe, expect, it } from "vitest";
import { squareCrop } from "../src/lib/photo";
import { newlyReadyPhotos } from "../src/lib/photo-celebration";

describe("squareCrop", () => {
  it("takes the centered square and scales down to 512 px", () => {
    expect(squareCrop(4032, 3024)).toEqual({ sx: 504, sy: 0, side: 3024, size: 512 });
    expect(squareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, side: 1080, size: 512 });
  });

  it("never scales small photos up", () => {
    expect(squareCrop(300, 400)).toEqual({ sx: 0, sy: 50, side: 300, size: 300 });
  });
});

function player(id: string, readyVersion: number | null): PublicPlayer {
  return {
    id,
    name: id,
    joinedAt: 0,
    connected: true,
    online: true,
    avatar: {
      character: "fox",
      color: "red",
      photo:
        readyVersion === null
          ? undefined
          : {
              status: "ready",
              version: readyVersion,
              readyVersion,
              accepted: false,
              expressions: ["neutral"],
              regenerationsLeft: 2,
              reason: null,
              path: `/api/rooms/ABCD/avatar/${id}`,
              saved: false,
            },
    },
  };
}

describe("newlyReadyPhotos", () => {
  it("celebrates new and replaced images, not players seen for the first time", () => {
    const first = newlyReadyPhotos(new Map(), [player("a", null), player("b", 1)]);
    expect(first.ready).toEqual([]);
    const second = newlyReadyPhotos(first.snapshot, [player("a", 1), player("b", 1), player("c", 1)]);
    expect(second.ready).toEqual(["a"]);
    const third = newlyReadyPhotos(second.snapshot, [player("a", 2), player("b", 1), player("c", 1)]);
    expect(third.ready).toEqual(["a"]);
  });
});
