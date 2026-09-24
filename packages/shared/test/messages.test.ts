import { describe, expect, it } from "vitest";
import { AVATAR_PARTS, AvatarSchema, ClientMessageSchema } from "../src";

describe("ClientMessageSchema", () => {
  it("accepts a valid join", () => {
    const r = ClientMessageSchema.safeParse({
      type: "join",
      name: "  Anna ",
      avatar: { character: "fox", color: "red" },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "join") expect(r.data.name).toBe("Anna");
  });

  it("rejects empty and too long names", () => {
    const avatar = { character: "fox", color: "red" };
    expect(ClientMessageSchema.safeParse({ type: "join", name: "   ", avatar }).success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ type: "join", name: "x".repeat(21), avatar }).success,
    ).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ type: "join", name: "x".repeat(20), avatar }).success,
    ).toBe(true);
  });

  it("rejects unknown avatar parts and message types", () => {
    expect(AvatarSchema.safeParse({ character: "nope", color: "red" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "explode" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse(null).success).toBe(false);
  });

  it("every avatar option in AVATAR_PARTS is valid in the schema", () => {
    const [characters, colors] = AVATAR_PARTS;
    for (const c of characters.options) {
      for (const col of colors.options) {
        expect(AvatarSchema.safeParse({ character: c.id, color: col.id }).success).toBe(true);
      }
    }
  });
});
