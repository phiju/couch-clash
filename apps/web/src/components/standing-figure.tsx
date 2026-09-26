"use client";

import { FIGURE_POSES, figureUrl, type FigurePose, type PublicPlayer } from "@couch-clash/shared";
import { memo, useEffect, useState, type ReactNode } from "react";
import { PARTY_HTTP_URL } from "@/lib/config";
import { FIGURE_CONFIG, alignShift, currentPose, feetAnchor, idlePhase, type FeetAnchor, type FigureReaction } from "@/lib/figure";

/** Feet position per image URL, measured once per URL (small canvas, never blocks anything). */
const anchors = new Map<string, Promise<FeetAnchor | null>>();

function measureFeet(url: string): Promise<FeetAnchor | null> {
  let p = anchors.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = 120;
          const h = Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(feetAnchor(ctx.getImageData(0, 0, w, h).data, w, h));
        } catch {
          resolve(null); // tainted canvas / no alpha: images are the same size anyway
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    anchors.set(url, p);
  }
  return p;
}

function useFeet(urls: readonly string[]): Record<string, FeetAnchor | null> {
  const [found, setFound] = useState<Record<string, FeetAnchor | null>>({});
  const key = urls.join("|");
  useEffect(() => {
    let alive = true;
    for (const url of urls) {
      void measureFeet(url).then((a) => {
        if (alive) setFound((prev) => (url in prev ? prev : { ...prev, [url]: a }));
      });
    }
    return () => {
      alive = false;
    };
    // `key` stands for the URL list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return found;
}

/**
 * A player's standing full-body figure. Falls back to the standing standard
 * figure when a pose is missing, and to `fallback` (the round avatar) when
 * there is no standing figure at all. All poses are stacked and cross-fade
 * (150 ms); each is shifted so its feet stand exactly where the standard
 * figure's feet are – changing the pose never makes the figure jump.
 * Idle motion is pure CSS on the image (pivot at the feet), so it never
 * re-renders anything.
 */
export const StandingFigure = memo(function StandingFigure({
  player,
  pose,
  reaction,
  fallback,
  className = "",
}: {
  player: PublicPlayer;
  /** The resting pose (e.g. from the danger level). */
  pose: FigurePose;
  /** A short reaction (cheering, shocked) on top of the resting pose. */
  reaction?: FigureReaction | null;
  /** What stands on the platform without any standing figure (the round avatar). */
  fallback: ReactNode;
  className?: string;
}) {
  const photo = player.avatar.photo;
  // A reaction shows until its time is up (then this key is "done" and the resting pose returns).
  const [doneKey, setDoneKey] = useState<string | number | null>(null);
  const reactionKey = reaction?.key;
  const reactionMs = reaction?.durationMs ?? 0;
  useEffect(() => {
    if (reactionKey === undefined) return;
    const t = setTimeout(() => setDoneKey(reactionKey), reactionMs);
    return () => clearTimeout(t);
  }, [reactionKey, reactionMs]);
  const shown = currentPose(pose, reaction && reaction.key !== doneKey ? reaction : null);
  const urls = FIGURE_POSES.map((p) => figureUrl(PARTY_HTTP_URL, photo, p));
  const standardUrl = urls[0];
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  const feet = useFeet(unique);
  const idle = FIGURE_CONFIG.idleAnimations ? "on" : "off";
  const delay = `${idlePhase(player.id)}s`;

  if (!standardUrl) {
    return (
      <div className={`fig ${className}`} data-idle={idle} style={{ ["--fig-delay" as string]: delay }}>
        <div className="fig-fallback" data-active data-pose="standard">
          {fallback}
        </div>
      </div>
    );
  }
  const activeUrl = figureUrl(PARTY_HTTP_URL, photo, shown);
  const reference = feet[standardUrl] ?? null;
  return (
    <div className={`fig ${className}`} data-idle={idle} style={{ ["--fig-delay" as string]: delay }}>
      {unique.map((url) => {
        const isActive = url === activeUrl;
        const anchor = feet[url] ?? null;
        const shift = alignShift(anchor, reference);
        const pivot = anchor ?? reference ?? { x: 50, y: 100 };
        return (
          <div
            key={url}
            className="fig-layer"
            data-active={isActive || undefined}
            style={{
              transitionDuration: `${FIGURE_CONFIG.crossfadeMs}ms`,
              transform: `translate(${shift.x}%, ${shift.y}%)`,
            }}
          >
            {/* Plain <img>: the figure comes from the party worker, not from Next. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              draggable={false}
              className="fig-img"
              data-pose={isActive ? shown : undefined}
              style={{ transformOrigin: `${pivot.x}% ${pivot.y}%` }}
            />
          </div>
        );
      })}
    </div>
  );
});
