import { z } from "zod";

/**
 * Avatar builder v1. Everything is data-driven: each part is a list of
 * options with a stable id. To add hats, faces, etc. later, add a new entry
 * to AVATAR_PARTS and a matching (optional) field to AvatarSchema.
 */
export interface AvatarOption {
  id: string;
  label: string;
  /** Emoji for character-like parts, CSS color for color parts. */
  value: string;
}

export interface AvatarPart {
  id: string;
  label: string;
  /** How the UI renders this part's options. */
  kind: "emoji" | "color";
  options: readonly AvatarOption[];
}

export const AVATAR_CHARACTERS = [
  { id: "fox", label: "Fuchs", value: "🦊" },
  { id: "panda", label: "Panda", value: "🐼" },
  { id: "frog", label: "Frosch", value: "🐸" },
  { id: "cat", label: "Katze", value: "🐱" },
  { id: "dog", label: "Hund", value: "🐶" },
  { id: "unicorn", label: "Einhorn", value: "🦄" },
  { id: "octopus", label: "Oktopus", value: "🐙" },
  { id: "penguin", label: "Pinguin", value: "🐧" },
  { id: "lion", label: "Löwe", value: "🦁" },
  { id: "monkey", label: "Affe", value: "🐵" },
  { id: "alien", label: "Alien", value: "👽" },
  { id: "robot", label: "Roboter", value: "🤖" },
  { id: "ghost", label: "Geist", value: "👻" },
  { id: "dino", label: "Dino", value: "🦖" },
  { id: "owl", label: "Eule", value: "🦉" },
  { id: "pig", label: "Schwein", value: "🐷" },
] as const satisfies readonly AvatarOption[];

export const AVATAR_COLORS = [
  { id: "red", label: "Rot", value: "#ef4444" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "yellow", label: "Gelb", value: "#facc15" },
  { id: "lime", label: "Limette", value: "#84cc16" },
  { id: "green", label: "Grün", value: "#22c55e" },
  { id: "teal", label: "Türkis", value: "#14b8a6" },
  { id: "sky", label: "Himmel", value: "#0ea5e9" },
  { id: "blue", label: "Blau", value: "#3b82f6" },
  { id: "violet", label: "Violett", value: "#8b5cf6" },
  { id: "pink", label: "Pink", value: "#ec4899" },
] as const satisfies readonly AvatarOption[];

export const AVATAR_PARTS = [
  { id: "character", label: "Figur", kind: "emoji", options: AVATAR_CHARACTERS },
  { id: "color", label: "Farbe", kind: "color", options: AVATAR_COLORS },
] as const satisfies readonly AvatarPart[];

export type AvatarPartId = (typeof AVATAR_PARTS)[number]["id"];

function optionIds<T extends readonly AvatarOption[]>(options: T) {
  return options.map((o) => o.id) as unknown as [
    T[number]["id"],
    ...T[number]["id"][],
  ];
}

export const AvatarSchema = z.object({
  character: z.enum(optionIds(AVATAR_CHARACTERS)),
  color: z.enum(optionIds(AVATAR_COLORS)),
});

export type Avatar = z.infer<typeof AvatarSchema>;

export const DEFAULT_AVATAR: Avatar = { character: "fox", color: "orange" };

export function getAvatarOption(
  partId: AvatarPartId,
  optionId: string,
): AvatarOption | undefined {
  const part = AVATAR_PARTS.find((p) => p.id === partId);
  return part?.options.find((o) => o.id === optionId);
}

export function randomAvatar(random: (max: number) => number): Avatar {
  return {
    character: AVATAR_CHARACTERS[random(AVATAR_CHARACTERS.length)]!.id,
    color: AVATAR_COLORS[random(AVATAR_COLORS.length)]!.id,
  };
}
