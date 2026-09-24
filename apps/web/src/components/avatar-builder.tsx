"use client";

import { AVATAR_PARTS, type Avatar } from "@couch-clash/shared";
import { AvatarBadge } from "./avatar";

/** Renders one picker per entry in AVATAR_PARTS – new parts show up automatically. */
export function AvatarBuilder({
  value,
  onChange,
}: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <AvatarBadge avatar={value} size="lg" className="animate-float" />
      {AVATAR_PARTS.map((part) => (
        <fieldset key={part.id} className="w-full">
          <legend className="mb-3 text-lg font-bold text-white/80">{part.label}</legend>
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
                    selected ? "scale-105 ring-4 ring-spot" : "ring-2 ring-white/15"
                  } ${part.kind === "emoji" ? "bg-white/10" : ""}`}
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
