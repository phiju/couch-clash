"use client";

import type { StealExtra } from "@couch-clash/games/meta";
import type { PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { knowledgeViews, type AddonHostProps, type AddonPlayerProps } from "../knowledge/views";

const fmt = (n: number) => n.toLocaleString("de-DE");

function targetsOf(extra: StealExtra, room: PublicRoomState) {
  return room.players.filter((p) => extra.targetIds.includes(p.id));
}

/** TV: "Ziel: Philip mit 1.500 Punkten" – and at the reveal what happened. */
function TargetBanner({ state, room }: AddonHostProps<StealExtra>) {
  const targets = targetsOf(state.extra, room);
  const outcome = state.extra.outcome;
  if (targets.length === 0) {
    return (
      <p className="fs-md shrink-0 self-center rounded-full chip px-5 py-[0.6vh] font-bold text-cream/80">
        Noch führt niemand – jede richtige Antwort zählt!
      </p>
    );
  }
  const names = targets.map((p) => p.name).join(" & ");
  const lost = outcome ? Object.values(outcome.lost).reduce((a, b) => a + b, 0) : 0;
  return (
    <div
      className={`flex shrink-0 animate-pop items-center gap-[1vw] self-center rounded-full border-4 px-[1.5vw] py-[0.8vh] ${
        outcome && !outcome.defended ? "border-bulb bg-orange text-cream" : "border-bulb bg-petrol-dark/90"
      }`}
    >
      {targets.map((p) => (
        <AvatarBadge key={p.id} avatar={p.avatar} size="fluidSm" />
      ))}
      <span className="fs-lg font-bold">
        {!outcome
          ? `🦹 Ziel: ${names} mit ${fmt(state.extra.targetScore)} Punkten`
          : outcome.defended
            ? `🛡️ ${names}: nichts geklaut!`
            : `🦹 Raubzug! ${names} ${targets.length > 1 ? "verlieren" : "verliert"} ${fmt(lost)} Punkte`}
      </span>
    </div>
  );
}

function PhoneTarget({ state, room, me }: AddonPlayerProps<StealExtra>) {
  const targets = targetsOf(state.extra, room);
  if (targets.length === 0) return null;
  const outcome = state.extra.outcome;
  const iAmTarget = state.extra.targetIds.includes(me.id);
  if (outcome) {
    const stolen = outcome.stolen[me.id];
    const lost = outcome.lost[me.id];
    if (lost) return <p className="text-xl font-bold text-orange">🦹 Du wurdest um {fmt(lost)} Punkte beklaut!</p>;
    if (stolen) return <p className="text-xl font-bold text-bulb">🦹 Du hast {fmt(stolen)} Punkte geklaut!</p>;
    if (iAmTarget) return <p className="text-xl font-bold text-bulb">🛡️ Verteidigt!</p>;
    return null;
  }
  return (
    <p className={`rounded-2xl px-4 py-2 text-center text-lg font-bold ${iAmTarget ? "bg-orange text-cream" : "chip"}`}>
      {iAmTarget
        ? "🎯 Du führst – antworte richtig, sonst wirst du beklaut!"
        : `🦹 Richtig antworten = ${targets.map((p) => p.name).join(" & ")} beklauen!`}
    </p>
  );
}

export const stealViews = knowledgeViews<StealExtra>({
  HostBanner: TargetBanner,
  PlayerBanner: PhoneTarget,
  revealTag: (state, p) => {
    const outcome = state.extra.outcome;
    if (outcome?.stolen[p.id]) return <span className="fs-sm rounded-full bg-bulb px-2 py-0.5 text-brown">🦹 Dieb</span>;
    if (outcome?.lost[p.id]) return <span className="fs-sm rounded-full bg-orange px-2 py-0.5 text-cream">💸 beklaut</span>;
    if (state.extra.targetIds.includes(p.id)) return <span className="fs-sm rounded-full chip px-2 py-0.5">🛡️ Spitze</span>;
    return null;
  },
});
