import { getAvatarOption, type Avatar } from "@couch-clash/shared";

const sizes = {
  xs: "size-9 text-xl ring-2",
  sm: "size-14 text-3xl ring-4",
  md: "size-24 text-5xl ring-4",
  lg: "size-40 text-8xl ring-4",
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
      className={`flex shrink-0 items-center justify-center rounded-full ring-bulb/80 transition ${sizes[size]} ${dimmed ? "opacity-40 grayscale" : ""} ${className}`}
      style={{ backgroundColor: color?.value ?? "#888" }}
      aria-label={character?.label}
      role="img"
    >
      <span className="leading-none">{character?.value ?? "❓"}</span>
    </div>
  );
}
