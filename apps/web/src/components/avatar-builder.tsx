"use client";

import { AVATAR_PARTS, type Avatar, type AvatarPartId } from "@couch-clash/shared";
import { AvatarBadge } from "./avatar";

/** Renders one picker per entry in AVATAR_PARTS – new parts show up automatically. */
export function AvatarBuilder({
  value,
  onChange,
  parts,
  preview = true,
  labels = {},
}: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  /** Only these parts (e.g. just the color). Default: all. */
  parts?: readonly AvatarPartId[];
  /** Show the big avatar preview on top. */
  preview?: boolean;
  /** Override part labels, e.g. { color: "Deine Farbe" }. */
  labels?: Partial<Record<AvatarPartId, string>>;
}) {
  const shown = parts ? AVATAR_PARTS.filter((p) => parts.includes(p.id)) : AVATAR_PARTS;
  return (
    <div className="flex w-full flex-col items-center gap-6">
      {preview && <AvatarBadge avatar={value} size="lg" className="animate-float" />}
      {shown.map((part) => (
        <fieldset key={part.id} className="w-full">
          <legend className="mb-3 text-lg font-bold text-cream/80">{labels[part.id] ?? part.label}</legend>
          <div
            className={`grid gap-2 ${part.kind === "emoji" ? "grid-cols-4 sm:grid-cols-8" : "grid-cols-5 sm:grid-cols-10"}`}
          >
            {part.options.map((option) => {
              const selected = value[part.id as keyof Avatar] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={selected}
                  onClick={() => onChange({ ...value, [part.id]: option.id })}
                  className={`flex aspect-square items-center justify-center rounded-2xl text-3xl transition ${
                    selected ? "scale-105 ring-4 ring-orange" : "ring-2 ring-bulb/40"
                  } ${part.kind === "emoji" ? "bg-petrol/60" : ""}`}
                  style={part.kind === "color" ? { backgroundColor: option.value } : undefined}
                >
                  {part.kind === "emoji" ? option.value : selected ? "✓" : ""}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
