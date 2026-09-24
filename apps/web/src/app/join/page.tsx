"use client";

import { ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode, ERROR_MESSAGES } from "@couch-clash/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <Screen className="justify-center gap-10">
      <Logo className="text-5xl" />
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center gap-6">
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
          className="w-full rounded-3xl bg-white px-4 py-5 text-center font-mono text-6xl font-black tracking-[0.3em] text-stage uppercase placeholder:text-stage/20 focus:ring-8 focus:ring-spot focus:outline-none"
        />
        {error && <p className="text-center text-lg font-bold text-hot">{error}</p>}
        <Button type="submit" disabled={code.length !== ROOM_CODE_LENGTH || busy} className="w-full">
          {busy ? "Suche…" : "Weiter"}
        </Button>
      </form>
    </Screen>
  );
}
