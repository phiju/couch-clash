import { getAvatarOption, type Avatar } from "@couch-clash/shared";

const sizes = {
  sm: "size-14 text-3xl",
  md: "size-24 text-5xl",
  lg: "size-40 text-8xl",
} as const;

export function AvatarBadge({
  avatar,
  size = "md",
  dimmed = false,
  className = "",
}: {
  avatar: Avatar;
  size?: keyof typeof sizes;
  dimmed?: boolean;
  className?: string;
}) {
  const character = getAvatarOption("character", avatar.character);
  const color = getAvatarOption("color", avatar.color);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ring-4 ring-white/80 transition ${sizes[size]} ${dimmed ? "opacity-40 grayscale" : ""} ${className}`}
      style={{ backgroundColor: color?.value ?? "#888" }}
      aria-label={character?.label}
      role="img"
    >
      <span className="leading-none">{character?.value ?? "❓"}</span>
    </div>
  );
}
