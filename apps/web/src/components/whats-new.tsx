"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangelogEntry } from "@/content/changelog";
import { CURRENT_VERSION, shortVersion, whatsNew } from "@/lib/changelog";
import { lastSeenVersionStore } from "@/lib/storage";

/**
 * "Juhu, neue Version!" – start page (TV / host device) only, after the
 * intro. First visit: nothing shown, the current version is remembered.
 * ESC, a click outside, "Los geht's" or the link close it and mark the
 * newest version as seen.
 */
export function WhatsNew({ ready }: { ready: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Decided once the intro is done (never on the server: storage lives in the browser).
  const decision = useMemo(() => (ready ? whatsNew(lastSeenVersionStore.get()) : null), [ready]);
  const open: { entries: ChangelogEntry[]; more: boolean } | null = decision?.show && !dismissed ? decision : null;

  useEffect(() => {
    if (decision && !decision.show && decision.store) lastSeenVersionStore.set(decision.store);
  }, [decision]);

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    lastSeenVersionStore.set(CURRENT_VERSION);
    setDismissed(true);
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 animate-[fade-in_0.3s_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="panel flex max-h-[90dvh] w-[min(36rem,94vw)] animate-pop flex-col gap-4 !rounded-[2rem] px-[clamp(1rem,4vw,2.5rem)] py-[clamp(1rem,3.5vh,2.2rem)] text-center shadow-[0_0_60px_rgb(253_188_95/0.35)]"
      >
        <div className="text-[clamp(2.2rem,6vh,3.5rem)] leading-none" aria-hidden>
          🎉
        </div>
        <h2 id="whats-new-title" className="text-[clamp(1.6rem,min(6.5vw,5vh),2.6rem)] leading-tight font-bold text-bulb">
          Juhu, neue Version!
        </h2>
        <p className="text-[clamp(1rem,min(4vw,2.4vh),1.3rem)] text-cream/90">
          Das ist neu bei Couch Clash (Version {shortVersion(CURRENT_VERSION)})
        </p>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto text-left">
          {open.entries.map((entry) => (
            <section key={entry.version} className="flex flex-col gap-2">
              {open.entries.length > 1 && (
                <h3 className="text-sm font-bold tracking-wide text-bulb/80 uppercase">
                  Version {shortVersion(entry.version)} · {entry.title}
                </h3>
              )}
              <ul className="flex flex-col gap-2">
                {entry.items.map((item) => (
                  <li key={item.text} className="flex items-center gap-3 rounded-2xl chip px-4 py-2 text-[clamp(0.95rem,min(3.8vw,2.2vh),1.2rem)]">
                    <span className="text-[1.4em]" aria-hidden>
                      {item.emoji}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {open.more && <p className="text-center text-cream/75">… und mehr</p>}
        </div>
        <button ref={buttonRef} type="button" onClick={close} className="btn btn-primary self-center px-10 py-3 text-2xl">
          Los geht&apos;s
        </button>
        <Link href="/neuigkeiten" onClick={close} className="text-cream/80 underline underline-offset-4">
          Alle Neuigkeiten
        </Link>
      </div>
    </div>
  );
}

/** Small footer on the start page: "v0.9 · Neuigkeiten". */
export function VersionFooter() {
  return (
    <Link
      href="/neuigkeiten"
      className="fixed bottom-2 left-3 z-10 text-xs text-cream/55 hover:text-cream/90 hover:underline"
    >
      v{shortVersion(CURRENT_VERSION)} · Neuigkeiten
    </Link>
  );
}
