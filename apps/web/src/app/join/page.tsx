"use client";

import { ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode, ERROR_MESSAGES } from "@couch-clash/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mascot } from "@/components/mascot";
import { Button, Logo, Screen } from "@/components/ui";
import { getRoomInfo } from "@/lib/api";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) {
      setError(ERROR_MESSAGES.ROOM_NOT_FOUND);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const info = await getRoomInfo(normalized);
      if (!info.exists) {
        setError(ERROR_MESSAGES.ROOM_NOT_FOUND);
        setBusy(false);
        return;
      }
      router.push(`/join/${normalized}`);
    } catch {
      setError("Der Spielserver ist gerade nicht erreichbar.");
      setBusy(false);
    }
  }

  return (
    <Screen dim="soft" className="justify-center gap-4">
      <Logo className="w-48" />
      {/* The only place the host appears on phones. */}
      <Mascot
        pose="walk-in"
        size="phone"
        className="-mb-10 self-start pl-2"
        imageClassName="h-48"
      />
      <form onSubmit={submit} className="panel relative flex w-full max-w-sm flex-col items-center gap-5 p-6">
        <label htmlFor="code" className="text-2xl font-bold">
          Code vom Fernseher
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => {
            setCode(normalizeRoomCode(e.target.value).slice(0, ROOM_CODE_LENGTH));
            setError(null);
          }}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABCD"
          className="w-full rounded-3xl border-4 border-bulb bg-cream px-4 py-4 text-center text-6xl font-bold tracking-[0.3em] text-brown uppercase placeholder:text-brown/25 focus:ring-8 focus:ring-orange/60 focus:outline-none"
        />
        {error && <p className="rounded-2xl bg-rust px-4 py-2 text-center text-lg font-bold">{error}</p>}
        <Button type="submit" disabled={code.length !== ROOM_CODE_LENGTH || busy} className="w-full">
          {busy ? "Suche…" : "Weiter"}
        </Button>
      </form>
    </Screen>
  );
}
