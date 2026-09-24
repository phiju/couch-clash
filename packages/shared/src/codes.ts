/**
 * Room codes: 4 characters from an alphabet without ambiguous characters
 * (no 0/O, 1/I/L). Easy to read off a TV and type on a phone.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_PATTERN = new RegExp(
  `^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);

/** Uppercases and strips whitespace so " ab cd " becomes "ABCD". */
export function normalizeRoomCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** `random` returns an integer in [0, max). Injectable for tests. */
export function generateRoomCode(
  random: (max: number) => number = secureRandomInt,
): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[random(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Unbiased random integer in [0, max) using Web Crypto (browser, Workers, Node). */
export function secureRandomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0]!;
    if (value < limit) return value % max;
  }
}

/** Random hex token, e.g. for host tokens and player secrets. */
export function generateSecret(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
