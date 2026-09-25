import Image from "next/image";
import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  danger: "btn bg-rust",
};

const base = "px-8 py-3.5 text-2xl tracking-wide";

export function Button({
  variant = "primary",
  glow = false,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; /** Subtle glow pulse for the main CTA. */ glow?: boolean }) {
  return (
    <button
      className={`${base} ${variants[variant]} ${glow ? "animate-glow" : ""} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  glow = false,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; glow?: boolean }) {
  return (
    <Link
      className={`inline-block text-center ${base} ${variants[variant]} ${glow ? "animate-glow" : ""} ${className}`}
      {...props}
    />
  );
}

/** Small logo for headers. The big stage logo lives in components/stage-logo.tsx. */
export function Logo({ className = "w-44" }: { className?: string }) {
  return (
    <Image
      src="/brand/logo.webp"
      alt="Couch Clash"
      width={1100}
      height={731}
      sizes="(max-width: 640px) 40vw, 260px"
      className={`h-auto drop-shadow-[0_6px_12px_rgba(0,0,0,0.45)] ${className}`}
    />
  );
}

/** Content panel on the stage: petrol-dark glass, cream text, bulb border. */
export function Panel({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`panel ${className}`} {...props} />;
}

/**
 * Page frame. `dim` darkens the stage behind the content:
 * "none" (start page), "soft" (join/waiting), "game" (questions, lists).
 */
export function Screen({
  children,
  className = "",
  dim = "game",
  fit = false,
}: {
  children?: React.ReactNode;
  className?: string;
  dim?: "none" | "soft" | "game";
  /** Host screens: exactly one viewport high, never scrolls (content scales/scrolls inside). */
  fit?: boolean;
}) {
  const size = fit
    ? // Below lg (unusual for a host) the page may scroll instead.
      "min-h-dvh lg:h-dvh lg:overflow-hidden px-[2vw] py-[2.2vh] gap-[2vh]"
    : "min-h-dvh px-4 py-8";
  return (
    <main className={`relative mx-auto flex w-full flex-col items-center ${size} ${className}`}>
      {dim !== "none" && <div className="stage-dim" data-level={dim} aria-hidden />}
      {children}
    </main>
  );
}

export function Notice({
  title,
  children,
  emoji = "😕",
}: {
  title: string;
  children?: React.ReactNode;
  emoji?: string;
}) {
  return (
    <div className="panel flex max-w-md flex-col items-center gap-6 p-8 text-center">
      <div className="text-7xl">{emoji}</div>
      <h2 className="text-3xl font-bold">{title}</h2>
      {children}
    </div>
  );
}

/**
 * Small connection hint at the bottom. `stuck` (connecting for a while):
 * a "Neu verbinden" button – retrying goes on in the background anyway.
 */
export function ConnectionBadge({
  status,
  stuck = false,
  onReconnect,
}: {
  status: "connecting" | "open" | "closed";
  stuck?: boolean;
  onReconnect?: () => void;
}) {
  if (status === "open") return null;
  if (stuck && onReconnect && status === "connecting") {
    return (
      <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border-2 border-bulb bg-petrol-dark py-1.5 pr-1.5 pl-4 text-sm font-bold whitespace-nowrap">
        Verbindung hakt …
        <button type="button" onClick={onReconnect} className="rounded-full bg-bulb px-3 py-1 text-brown">
          Neu verbinden
        </button>
      </div>
    );
  }
  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border-2 border-bulb bg-petrol-dark px-4 py-2 text-sm font-bold">
      {status === "connecting" ? "Verbinde…" : "Verbindung getrennt"}
    </div>
  );
}
