import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-spot text-stage shadow-[0_6px_0_#b8901a] hover:brightness-105 active:translate-y-1 active:shadow-[0_2px_0_#b8901a]",
  secondary:
    "bg-white/10 text-white ring-2 ring-white/30 hover:bg-white/20 active:translate-y-0.5",
  danger: "bg-hot text-white shadow-[0_6px_0_#a8254a] active:translate-y-1 active:shadow-[0_2px_0_#a8254a]",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-2xl px-8 py-4 text-2xl font-black tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={`inline-block rounded-2xl px-8 py-4 text-center text-2xl font-black tracking-wide transition ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <h1
      className={`font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.35)] ${className}`}
    >
      <span className="text-spot">Couch</span> <span className="text-hot">Clash</span>
    </h1>
  );
}

export function Screen({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <main className={`mx-auto flex min-h-dvh w-full flex-col items-center px-4 py-8 ${className}`}>
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
    <div className="flex max-w-md flex-col items-center gap-6 text-center">
      <div className="text-7xl">{emoji}</div>
      <h2 className="text-3xl font-black">{title}</h2>
      {children}
    </div>
  );
}

export function ConnectionBadge({ status }: { status: "connecting" | "open" | "closed" }) {
  if (status === "open") return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm font-bold">
      {status === "connecting" ? "Verbinde…" : "Verbindung getrennt"}
    </div>
  );
}
