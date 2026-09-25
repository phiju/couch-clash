"use client";

import type { ClientMessage, PublicRoomState } from "@couch-clash/shared";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AvatarBadge } from "@/components/avatar";
import { Mascot } from "@/components/mascot";
import { Sparkle } from "@/components/sparkle";
import { Button, Logo, Screen } from "@/components/ui";
import { displayJoinLink, joinUrl as buildJoinUrl } from "@/lib/config";
import { initialLobbySettingsOpen } from "@/lib/lobby-panel";
import { summaryText } from "@/lib/summary";
import { usePhotoCelebration } from "./photo-celebration";
import { GameSettingsPanel } from "./settings-panel";
import { useHostSpeech } from "./voice";
import { VoiceSettingsPanel } from "./voice-settings";

const subscribeNoop = () => () => {};

export function HostLobby({
  room,
  send,
  canSend,
}: {
  room: PublicRoomState | null;
  send: (msg: ClientMessage) => void;
  canSend: boolean;
}) {
  const startRef = useRef<(() => void) | null>(null);
  const code = room?.code ?? "";
  const players = room?.players ?? [];
  const celebrating = usePhotoCelebration(players);
  const speech = useHostSpeech();
  // Settings column: collapsed on load, opened with "⚙️ Einstellungen", closed with "✕".
  const [settingsOpen, setSettingsOpen] = useState(initialLobbySettingsOpen);
  const toggleSettings = () => setSettingsOpen((open) => !open);
  const joinUrl = useSyncExternalStore(
    subscribeNoop,
    () => (code ? buildJoinUrl(code) : null),
    () => null,
  );

  return (
    <Screen fit className="max-w-[2400px]">
      <header className="flex w-full shrink-0 items-center justify-between gap-3 pr-14">
        <Logo className="w-[clamp(6rem,min(10vw,14vh),12rem)]" />
        <div className="flex items-center gap-[0.8vw]">
          <p className="fs-md rounded-full chip px-5 py-2 font-bold">
            {players.length} {players.length === 1 ? "Spieler:in" : "Spieler:innen"}
          </p>
          {/* Collapsed: the current setup at a glance (or "Noch keine Kategorie gewählt"). */}
          {!settingsOpen && room && (
            <p className="fs-md hidden rounded-full chip px-5 py-2 font-bold text-cream/85 lg:block">
              {summaryText(room.settingsSummary)}
            </p>
          )}
          <button
            type="button"
            onClick={toggleSettings}
            aria-expanded={settingsOpen}
            aria-controls="lobby-settings"
            className="fs-md rounded-full border-2 border-bulb/70 bg-petrol-dark/80 px-4 py-2 font-bold transition hover:bg-petrol"
            title={settingsOpen ? "Einstellungen einklappen" : "Einstellungen öffnen"}
          >
            {settingsOpen ? "✕" : "⚙️ Einstellungen"}
          </button>
        </div>
      </header>

      <div
        data-settings={settingsOpen ? "open" : "closed"}
        className="lobby-grid grid min-h-0 w-full flex-1 gap-[1.6vw] transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none"
      >
        {/* The host stands next to the QR code – only where there is room for him. */}
        <Mascot
          pose="idle"
          talking={!!speech}
          className="z-10 hidden min-h-0 self-end justify-center roomy:flex"
          imageClassName="h-[min(58vh,640px)] max-w-none"
        />

        <section className="panel @container flex min-h-0 flex-col items-center justify-center gap-[1.8vh] p-[2vh]">
          <p className="fs-lg text-center font-bold text-cream/85">Mitspielen mit dem Code</p>
          <p className="text-[min(24cqw,14vh)] leading-none font-bold tracking-[0.1em] whitespace-nowrap text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
            {code}
          </p>
          {joinUrl && (
            <>
              <div className="aspect-square w-[min(80cqw,38vh)] shrink rounded-3xl border-4 border-bulb bg-cream p-[1.4vh]">
                <QRCodeSVG value={joinUrl} size={256} marginSize={0} style={{ width: "100%", height: "100%" }} />
              </div>
              <p className="fs-md text-center text-cream/80">
                QR-Code scannen oder öffnen:
                <br />
                <span className="font-bold whitespace-nowrap text-bulb">{displayJoinLink()}</span>
              </p>
            </>
          )}
        </section>

        <section className="panel flex min-h-0 flex-col gap-[1.8vh] p-[2vh]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="fs-title font-bold">
              {players.length === 0 ? "Warte auf Mitspieler:innen…" : "Wer ist dabei?"}
            </h2>
            {room && (
              <label className="fs-sm flex cursor-pointer items-center gap-2 font-bold text-cream/85">
                <input
                  type="checkbox"
                  role="switch"
                  checked={room.photoAvatars}
                  disabled={!canSend}
                  onChange={(e) => send({ type: "set_photo_avatars", enabled: e.target.checked })}
                  className="size-5 accent-orange"
                />
                📸 Foto-Avatare erlauben
              </label>
            )}
            {room && (
              <label className="fs-sm flex cursor-pointer items-center gap-2 font-bold text-cream/85">
                <input
                  type="checkbox"
                  role="switch"
                  checked={room.lateJoin}
                  disabled={!canSend}
                  onChange={(e) => send({ type: "set_late_join", enabled: e.target.checked })}
                  className="size-5 accent-orange"
                />
                🚪 Neue Spieler während des Spiels zulassen
              </label>
            )}
          </div>

          <PlayerGrid playerCount={players.length} big={!settingsOpen}>
            {players.map((player) => (
              <li
                key={player.id}
                className="relative flex aspect-[4/5] w-[var(--card)] animate-pop flex-col items-center justify-center gap-[calc(var(--card)*0.03)] overflow-hidden rounded-3xl chip p-[calc(var(--card)*0.06)]"
              >
                <div className="relative">
                  <AvatarBadge avatar={player.avatar} size="card" dimmed={!player.connected} />
                  {celebrating.has(player.id) && <Sparkle />}
                  {player.avatar.photo?.status === "pending" && (
                    <span
                      className="absolute -right-2 -bottom-1 animate-pulse rounded-full bg-orange px-1.5 text-base"
                      title="Foto-Figur wird gemalt"
                    >
                      ✨
                    </span>
                  )}
                </div>
                <span className="line-clamp-2 w-full text-center text-[calc(var(--card)*0.11)] leading-tight font-bold [overflow-wrap:anywhere] text-balance">
                  {player.name}
                </span>
                <span
                  className={`flex items-center gap-1.5 text-[calc(var(--card)*0.075)] font-bold ${player.connected ? "text-bulb" : "text-cream/50"}`}
                >
                  <span className={`size-2.5 rounded-full ${player.connected ? "bg-bulb" : "bg-cream/40"}`} />
                  {player.connected ? "verbunden" : "getrennt"}
                </span>
                {player.avatar.photo && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Foto-Figur von ${player.name} löschen? (Das Emoji bleibt.)`)) {
                        send({ type: "photo_reset", playerId: player.id });
                      }
                    }}
                    className="rounded-full bg-petrol-dark/60 px-3 text-[calc(var(--card)*0.075)] font-bold text-cream/70 transition hover:bg-rust hover:text-cream"
                  >
                    ↺ Emoji
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`${player.name} aus dem Spiel entfernen?`)) {
                      send({ type: "kick", playerId: player.id });
                    }
                  }}
                  className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-petrol-dark/60 text-base font-bold text-cream/70 transition hover:bg-rust hover:text-cream"
                  aria-label={`${player.name} entfernen`}
                  title="Entfernen"
                >
                  ✕
                </button>
              </li>
            ))}
          </PlayerGrid>

          {/* Always visible – the player list scrolls instead. */}
          <div className="flex shrink-0 flex-col items-center gap-[1vh] lg:items-end">
            <p className="fs-md text-right font-bold text-cream/80">{summaryText(room?.settingsSummary ?? null)}</p>
            <Button
              onClick={() => startRef.current?.()}
              disabled={players.length === 0 || !canSend || !room?.settingsSummary}
              glow
              className="fs-xl !px-[2.2vw] !py-[1.3vh] whitespace-nowrap"
            >
              Spiel starten
            </Button>
          </div>
        </section>

        {room && (
          <section
            id="lobby-settings"
            // Stays mounted when collapsed ("Spiel starten" uses it), just slides out.
            inert={!settingsOpen}
            aria-hidden={!settingsOpen}
            className={`panel flex min-h-0 flex-col p-[2vh] transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none ${
              settingsOpen ? "" : "pointer-events-none translate-x-[110%] opacity-0 max-lg:hidden"
            }`}
          >
            {/* The settings scroll inside their column. */}
            <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
              <GameSettingsPanel
                serverSettings={room.settings}
                send={send}
                canSend={canSend}
                startRef={startRef}
                playerCount={room.players.length}
                mode={room.mode}
                partyConfirmed={room.partyConfirmed}
                poolSizes={room.poolSizes}
                compact
              />
              <div className="mt-[1.4vh]">
                <VoiceSettingsPanel voice={room.voice} send={send} canSend={canSend} compact />
              </div>
            </div>
          </section>
        )}
      </div>
    </Screen>
  );
}

/**
 * Players (and placeholders) in one regular grid: fixed card width, cards
 * aligned top-left, never stretched. Placeholders only fill the first row.
 */
function PlayerGrid({ playerCount, big, children }: { playerCount: number; big: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fires once right away and on every size change.
    const observer = new ResizeObserver(() => {
      const n = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      if (n > 0) setColumns(n);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const placeholders = Math.max(0, columns - playerCount);
  return (
    <ul
      ref={ref}
      data-big={big || undefined}
      className="player-grid grid min-h-0 flex-1 auto-rows-min content-start justify-start gap-[clamp(8px,1vw,18px)] overflow-y-auto pr-1"
    >
      {children}
      {Array.from({ length: placeholders }, (_, i) => (
        <li
          key={`placeholder-${i}`}
          aria-hidden
          className="flex aspect-[4/5] w-[var(--card)] items-center justify-center rounded-3xl border-[3px] border-dashed border-bulb/25 text-[calc(var(--card)*0.2)] font-bold text-cream/25"
        >
          ?
        </li>
      ))}
    </ul>
  );
}
