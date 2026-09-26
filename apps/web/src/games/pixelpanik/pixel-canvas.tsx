"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The picture of the current stage. Pixelated stages: the (pre-rendered,
 * tiny) picture is drawn onto an N×N canvas and scaled up with
 * imageSmoothingEnabled = false – crisp blocks. Full resolution (size 0):
 * drawn smooth, with a short "snap" (flash + bounce) when it appears.
 * The previous frame stays until the next picture has loaded (no flicker).
 */
export function PixelCanvas({ url, size, className = "" }: { url: string; size: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapKey, setSnapKey] = useState<string | null>(null);
  const loaded = useRef<{ img: HTMLImageElement; size: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      loaded.current = { img, size };
      draw(canvasRef.current, img, size);
      if (size === 0) setSnapKey(url);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  // Sharp blocks at every screen size: redraw when the canvas changes size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (loaded.current) draw(canvas, loaded.current.img, loaded.current.size);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const snapping = snapKey === url && size === 0;
  return (
    <div className={`relative overflow-hidden rounded-[2rem] border-4 border-bulb bg-petrol-dark shadow-[0_8px_0_var(--color-brown)] ${className}`}>
      <canvas
        ref={canvasRef}
        key="canvas"
        className={`block size-full [image-rendering:pixelated] ${snapping ? "animate-pp-snap" : ""}`}
        aria-label={size === 0 ? "Das Bild in voller Auflösung" : `Das Bild, verpixelt auf ${size}×${size}`}
        role="img"
      />
      {snapping && <div key={url} className="animate-pp-flash pointer-events-none absolute inset-0 bg-cream" aria-hidden />}
    </div>
  );
}

function draw(canvas: HTMLCanvasElement | null, img: HTMLImageElement, size: number) {
  if (!canvas) return;
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const px = Math.max(1, Math.round(canvas.clientWidth * ratio));
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, px, px);
  if (size > 0) {
    // 1. Onto N×N (the stage file already is N×N – this also copes with a bigger file).
    const small = document.createElement("canvas");
    small.width = size;
    small.height = size;
    const s = small.getContext("2d");
    if (!s) return;
    s.imageSmoothingEnabled = true;
    s.drawImage(img, 0, 0, size, size);
    // 2. Scaled up without smoothing: hard blocks.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, px, px);
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, px, px);
  }
}
