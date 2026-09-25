"use client";

import type { CategoryPickExtra, CategoryPickPublicState } from "@couch-clash/games/meta";
import { HOST_ACTOR_ID, KNOWLEDGE_CATEGORY_LABELS, type KnowledgeCategory, type PublicRoomState } from "@couch-clash/shared";
import { useState } from "react";
import { AvatarBadge } from "@/components/avatar";
import {
  CATEGORY_EMOJI,
  PreCountdown,
  knowledgeViews,
  type AddonHostProps,
  type AddonPlayerProps,
} from "../knowledge/views";

function pickerOf(state: CategoryPickPublicState, room: PublicRoomState) {
  const id = state.extra.pickerId;
  return { host: id === HOST_ACTOR_ID, player: room.players.find((p) => p.id === id) };
}

function CategoryCard({
  category,
  onPick,
  size,
  chosen,
}: {
  category: KnowledgeCategory;
  onPick?: () => void;
  size: "tv" | "phone";
  chosen?: boolean;
}) {
  const tv = size === "tv";
  const content = (
    <>
      <span className={tv ? "text-[min(7rem,11vh)] leading-none" : "text-5xl"}>{CATEGORY_EMOJI[category]}</span>
      <span className={`font-bold text-balance ${tv ? "fs-xl" : "text-2xl"}`}>{KNOWLEDGE_CATEGORY_LABELS[category]}</span>
    </>
  );
  const cls = `flex flex-col items-center justify-center gap-[1vh] rounded-[2rem] border-4 border-bulb bg-orange text-cream shadow-[0_6px_0_var(--color-brown)] transition ${
    tv ? "min-h-[26vh] px-[1.5vw] py-[2vh]" : "min-h-28 px-5 py-4"
  } ${chosen ? "scale-105 ring-8 ring-cream/90" : ""}`;
  if (!onPick) return <div className={`${cls} animate-pop`}>{content}</div>;
  return (
    <button type="button" onClick={onPick} className={`${cls} active:translate-y-1 active:shadow-none`}>
      {content}
    </button>
  );
}

/** TV: the picker big with avatar + three category cards (clickable when the host picks). */
function HostPick({ state, room, sendAction }: AddonHostProps<CategoryPickExtra>) {
  const { host, player } = pickerOf(state, room);
  const canPick = host && !!sendAction && !state.extra.selectedCategory;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-[3vh]">
      <div className="w-full max-w-[70vw]">
        <PreCountdown state={state} />
      </div>
      <div className="flex items-center gap-[2vw]">
        {player && <AvatarBadge avatar={player.avatar} size="fluid" className="animate-pop" />}
        <div className="flex flex-col">
          <span className="fs-md font-bold text-cream/70">{host ? "Heute bestimmt der Host" : state.extra.byLot ? "Das Los hat entschieden" : "Letzter Platz, erste Wahl"}</span>
          <span className="fs-title font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
            {host ? "Host, wähl eine Kategorie!" : `${player?.name ?? "…"} wählt …`}
          </span>
        </div>
      </div>
      <ul className="grid w-full max-w-[80vw] grid-cols-3 gap-[2vw]">
        {state.extra.offer.map((c) => (
          <li key={c}>
            <CategoryCard
              category={c}
              size="tv"
              chosen={state.extra.selectedCategory === c}
              onPick={canPick ? () => sendAction!({ type: "pick", category: c }) : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Phone: only the picker sees the cards; everybody else waits. */
function PlayerPick({ state, room, me, sendAction }: AddonPlayerProps<CategoryPickExtra>) {
  const [sent, setSent] = useState<string | null>(null);
  const { host, player } = pickerOf(state, room);
  const mine = state.extra.pickerId === me.id;
  const key = `${state.index}`;
  if (!mine || sent === key || state.extra.selectedCategory) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
        <PreCountdown state={state} size="sm" />
        <div className="animate-float text-7xl">🎯</div>
        <p className="text-3xl font-bold text-bulb">
          {mine ? "Gewählt!" : host ? "Der Host wählt …" : `${player?.name ?? "…"} wählt …`}
        </p>
        <p className="text-xl text-cream/70">Gleich geht’s los – schau auf den Fernseher!</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      <PreCountdown state={state} size="sm" />
      <p className="panel px-5 py-4 text-center text-2xl font-bold text-balance">
        {state.extra.byLot ? "Das Los hat entschieden: Du wählst die Kategorie!" : "Du liegst hinten – du wählst die Kategorie!"}
      </p>
      <div className="grid flex-1 grid-cols-1 gap-4">
        {state.extra.offer.map((c) => (
          <CategoryCard
            key={c}
            category={c}
            size="phone"
            onPick={() => {
              setSent(key);
              sendAction({ type: "pick", category: c });
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Above the question: who picked this category. */
function PickedBanner({ state, room }: AddonHostProps<CategoryPickExtra>) {
  const { host, player } = pickerOf(state, room);
  if (!state.extra.selectedCategory) return null;
  const who = state.extra.pickedBy === "random" ? "Der Zufall" : host ? "Der Host" : (player?.name ?? "…");
  return (
    <p className="fs-md shrink-0 self-center rounded-full chip px-5 py-[0.6vh] font-bold text-cream/80">
      🎯 Ausgesucht von {who}
    </p>
  );
}

export const categoryPickViews = knowledgeViews<CategoryPickExtra>({
  HostPre: HostPick,
  PlayerPre: PlayerPick,
  HostBanner: PickedBanner,
  revealTag: (state, p) =>
    state.extra.pickerId === p.id && state.extra.pickedBy === "picker" ? (
      <span className="fs-sm rounded-full bg-orange px-2 py-0.5 text-cream">🎯 gewählt</span>
    ) : null,
});
