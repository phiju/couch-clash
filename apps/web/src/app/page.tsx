"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, Logo, Screen } from "@/components/ui";
import { createRoom } from "@/lib/api";
import { hostTokenStore } from "@/lib/storage";

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Screen className="justify-center gap-10 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-float text-7xl">🛋️⚡</div>
        <Logo className="text-6xl sm:text-8xl" />
        <p className="max-w-lg text-xl text-white/80 sm:text-2xl">
          Die Partyspiel-Show fürs Wohnzimmer. Ein Fernseher, alle Handys.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Button onClick={newGame} disabled={busy} className="py-6 text-3xl">
          {busy ? "Moment…" : "Neues Spiel"}
        </Button>
        <ButtonLink href="/join" variant="secondary">
          Mitspielen
        </ButtonLink>
        {error && <p className="font-bold text-hot">{error}</p>}
      </div>
    </Screen>
  );
}
