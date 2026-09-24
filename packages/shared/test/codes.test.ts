import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  generateRoomCode,
  generateSecret,
  isValidRoomCode,
  normalizeRoomCode,
} from "../src";

describe("room codes", () => {
  it("alphabet has no ambiguous characters", () => {
    for (const c of ["0", "O", "1", "I", "L"]) expect(ROOM_CODE_ALPHABET).not.toContain(c);
  });

  it("generates valid 4-char codes", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(4);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it("uses the injected random source", () => {
    expect(generateRoomCode(() => 0)).toBe("AAAA");
  });

  it("normalizes user input", () => {
    expect(normalizeRoomCode(" ab cd ")).toBe("ABCD");
  });

  it("rejects invalid codes", () => {
    expect(isValidRoomCode("ABC")).toBe(false);
    expect(isValidRoomCode("ABCDE")).toBe(false);
    expect(isValidRoomCode("AB0D")).toBe(false);
    expect(isValidRoomCode("abcd")).toBe(false);
  });

  it("generates hex secrets", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[0-9a-f]{48}$/);
    expect(generateSecret()).not.toBe(s);
  });
});
