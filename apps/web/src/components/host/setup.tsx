"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { useRef } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Button, Logo, Screen } from "@/components/ui";
import { GameSettingsPanel } from "./settings-panel";
import { VoiceSettingsPanel } from "./voice-settings";

/** Setup phase – only used after "Nochmal spielen" (the first game is set up in the lobby). */
export function HostSetup({
  room,
  send,
  canSend,
}: {
  room: PublicRoomState;
  send: (msg: ClientMessage) => void;
  canSend: boolean;
}) {
  const startRef = useRef<(() => void) | null>(null);
  return (
    <Screen className="max-w-[1600px] gap-8 lg:py-10">
      <header className="flex w-full flex-wrap items-center justify-between gap-4 pr-14">
        <Logo className="w-36" />
        <div className="flex -space-x-3">
          {room.players.map((p) => (
            <AvatarBadge key={p.id} avatar={p.avatar} size="sm" dimmed={!p.connected} />
          ))}
        </div>
      </header>

      <div className="panel w-full p-6">
        <GameSettingsPanel serverSettings={room.settings} send={send} canSend={canSend} startRef={startRef} />
        <div className="mt-6 max-w-xl">
          <VoiceSettingsPanel voice={room.voice} send={send} canSend={canSend} />
        </div>
      </div>

      <footer className="mt-auto flex w-full flex-wrap items-center justify-between gap-4">
        <Button variant="secondary" onClick={() => send({ type: "back_to_lobby" })} className="text-xl">
          ← Zurück zur Lobby
        </Button>
        <Button
          onClick={() => startRef.current?.()}
          disabled={!room.settingsSummary || !canSend}
          glow
          className="px-12 py-5 text-4xl"
        >
          Los geht&apos;s!
        </Button>
      </footer>
    </Screen>
  );
}
