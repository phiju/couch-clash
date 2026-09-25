import Image from "next/image";

/**
 * The game show host. All mascot usage goes through this component.
 * He never shows speech bubbles – he speaks (host device only, see
 * components/host/voice.tsx) and bounces slightly while talking.
 * To add a pose with its own artwork: add an image to POSE_IMAGES and a
 * keyframe rule for `.mascot[data-pose="…"]` in globals.css.
 */
export type MascotPose = "idle" | "walk-in" | "announce" | "cheer";

const IMAGES = {
  tv: { src: "/brand/host.webp", width: 520, height: 1123 },
  phone: { src: "/brand/host-small.webp", width: 260, height: 561 },
} as const;

/** Per-pose artwork (all poses use the same image for now). */
const POSE_IMAGES: Record<MascotPose, keyof typeof IMAGES | undefined> = {
  idle: undefined,
  "walk-in": undefined,
  announce: undefined,
  cheer: undefined,
};

export function Mascot({
  pose = "idle",
  size = "tv",
  className = "",
  imageClassName = "h-[60vh]",
  talking = false,
  prop,
}: {
  pose?: MascotPose;
  /** "phone" uses the smaller image. */
  size?: "tv" | "phone";
  className?: string;
  /** Size of the figure, e.g. "h-[60vh]". */
  imageClassName?: string;
  /** Speaking right now (the voice plays): small bounce. */
  talking?: boolean;
  /** Something he holds under his arm while playing a role (e.g. the driving instructor's clipboard). */
  prop?: React.ReactNode;
}) {
  const image = IMAGES[POSE_IMAGES[pose] ?? size];
  return (
    <div className={`pointer-events-none relative flex items-end ${className}`} data-talking={talking || undefined}>
      <Image
        src={image.src}
        alt=""
        width={image.width}
        height={image.height}
        sizes={size === "tv" ? "(max-aspect-ratio: 3/4) 40vw, 22vw" : "30vw"}
        data-pose={pose}
        className={`mascot w-auto ${imageClassName}`}
      />
      {prop && (
        // Tucked under his left arm (the hand in the pocket), moves with the figure's box.
        <div className="absolute right-[2%] bottom-[40%] h-[20%] w-[42%] rotate-[10deg]">{prop}</div>
      )}
    </div>
  );
}
