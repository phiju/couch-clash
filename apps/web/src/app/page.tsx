"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { StageIntro } from "@/components/stage-intro";
import { Button, ButtonLink } from "@/components/ui";
import { VersionFooter, WhatsNew } from "@/components/whats-new";
import { createRoom } from "@/lib/api";
import { hostTokenStore } from "@/lib/storage";

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const onIntroDone = useCallback(() => setIntroDone(true), []);

  async function newGame() {
    setBusy(true);
    setError(null);
    try {
      const { code, hostToken } = await createRoom();
      hostTokenStore.set(code, hostToken);
      router.push(`/host/${code}`);
    } catch {
      setError("Der Spielserver ist gerade nicht erreichbar. Versuch es gleich nochmal.");
      setBusy(false);
    }
  }

  return (
    <main>
      <h1 className="sr-only">Couch Clash – die Partyspiel-Show fürs Wohnzimmer</h1>
      <StageIntro onDone={onIntroDone}>
        <Button onClick={newGame} disabled={busy} className="px-10 text-2xl wide:min-w-72 wide:text-3xl">
          {busy ? "Moment…" : "Neues Spiel"}
        </Button>
        <ButtonLink href="/join" variant="secondary" className="px-10 text-2xl wide:min-w-72 wide:text-3xl">
          Beitreten
        </ButtonLink>
      </StageIntro>
      <VersionFooter />
      <WhatsNew ready={introDone} />
      {error && (
        <p className="fixed top-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-rust px-6 py-3 text-center text-lg font-bold">
          {error}
        </p>
      )}
    </main>
  );
}
