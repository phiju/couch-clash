"use client";

import type { QuestionMedia } from "@couch-clash/shared";
import { SignStack } from "./sign-stack";
import { TrafficScene } from "./traffic-scene";

/** The picture of a question: traffic sign(s) or a junction scene. */
export function MediaView({
  media,
  variant = "tv",
  driveOrder = null,
}: {
  media: QuestionMedia;
  variant?: "tv" | "phone";
  driveOrder?: readonly string[] | null;
}) {
  if (media.kind === "sign") return <SignStack signs={media.signs} variant={variant} />;
  return (
    <TrafficScene
      scene={media}
      variant={variant}
      driveOrder={driveOrder}
      className={
        variant === "tv"
          ? "aspect-square h-full max-h-full w-auto max-w-full rounded-[2.6vh] shadow-[0_10px_0_var(--color-brown),0_20px_40px_rgb(0_0_0/0.4)]"
          : "mx-auto aspect-square max-h-[38vh] w-auto max-w-full rounded-2xl"
      }
    />
  );
}
