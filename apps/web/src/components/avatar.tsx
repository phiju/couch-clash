"use client";

import {
  getAvatarOption,
  photoAvatarUrl,
  type Avatar,
  type PhotoExpression,
  type PublicAvatar,
} from "@couch-clash/shared";
import { useState } from "react";
import { PARTY_HTTP_URL } from "@/lib/config";

const sizes = {
  xs: "size-9 text-xl ring-2",
  sm: "size-14 text-3xl ring-4",
  md: "size-24 text-5xl ring-4",
  lg: "size-40 text-8xl ring-4",
  /** Host screens: scales with the viewport (width and height). */
  fluid: "size-[clamp(3rem,min(5.5vw,9.5vh),7rem)] text-[clamp(1.7rem,min(3vw,5.2vh),3.8rem)] ring-4",
  fluidSm: "size-[clamp(2.25rem,min(3.4vw,6vh),4.5rem)] text-[clamp(1.2rem,min(1.9vw,3.3vh),2.5rem)] ring-[3px]",
} as const;

/**
 * Round avatar: the AI photo character (ring in the chosen color) when one is
 * ready, else the emoji on the chosen color. Broken images fall back to the emoji.
 */
export function AvatarBadge({
  avatar,
  size = "md",
  dimmed = false,
  expression = "neutral",
  className = "",
}: {
  avatar: Avatar | PublicAvatar;
  size?: keyof typeof sizes;
  dimmed?: boolean;
  /** Face of the photo avatar (falls back to neutral). */
  expression?: PhotoExpression;
  className?: string;
}) {
  const character = getAvatarOption("character", avatar.character);
  const color = getAvatarOption("color", avatar.color)?.value ?? "#888";
  const url = "photo" in avatar ? photoAvatarUrl(PARTY_HTTP_URL, avatar.photo, expression) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = url !== null && failedUrl !== url;
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full transition ${sizes[size]} ${
        showPhoto ? "bg-cream" : "ring-bulb/80"
      } ${dimmed ? "opacity-40 grayscale" : ""} ${className}`}
      style={showPhoto ? { ["--tw-ring-color" as string]: color } : { backgroundColor: color }}
      aria-label={character?.label}
      role="img"
    >
      {showPhoto ? (
        // Plain <img>: the image comes from the party worker, not from Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span className="leading-none">{character?.value ?? "❓"}</span>
      )}
    </div>
  );
}
