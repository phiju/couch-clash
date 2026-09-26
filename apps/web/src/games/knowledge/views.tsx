"use client";

/**
 * TV + phone views shared by every knowledge game (the former quiz views).
 * Game-specific parts are small add-ons (KnowledgeAddon): the pre-step
 * (category cards, cash out / bet, wager picker), banners and reveal tags.
 * No scoring here – points come from the server.
 */
import type { KnowledgePublicState } from "@couch-clash/games/meta";
import {
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeCategory,
  type PhotoExpression,
  type PublicPlayer,
  type PublicRoomState,
} from "@couch-clash/shared";
import { useState, type ComponentType, type ReactNode } from "react";
import { AvatarBadge } from "@/components/avatar";
import { questionRoundAudio, type ModuleAudioScene } from "@/lib/audio/scenes";
import {
  AnswerSent,
  AnsweredStrip,
  Countdown,
  PlayerRevealResult,
  QuestionCounter,
  QuestionLeaderboard,
  RevealTable,
} from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { GameViews, HostViewProps, PlayerViewProps } from "../types";

export const CATEGORY_EMOJI: Record<KnowledgeCategory, string> = {
  HISTORY: "🏛️",
  GEOGRAPHY: "🌍",
  SCIENCE: "🔬",
  NATURE: "🦊",
  TECHNOLOGY: "💻",
  SPORTS: "⚽",
  MOVIES_TV: "🎬",
  MUSIC: "🎵",
  ART_CULTURE: "🎨",
  LANGUAGE_LITERATURE: "📚",
  FOOD_DRINK: "🍕",
  SOCIETY: "🏙️",
  BUSINESS: "💼",
  MOBILITY: "🚗",
  GAMES: "🎮",
};

export interface AddonHostProps<E> {
  state: KnowledgePublicState<E>;
  room: PublicRoomState;
  sendAction?: (action: unknown) => void;
}

export interface AddonPlayerProps<E> {
  state: KnowledgePublicState<E>;
  room: PublicRoomState;
  me: PublicPlayer;
  sendAction: (action: unknown) => void;
}

/** The game-specific bits on top of the shared views. */
export interface KnowledgeAddon<E> {
  /** TV during the pre-step (pick / decide / wager). */
  HostPre?: ComponentType<AddonHostProps<E>>;
  /** Phone during the pre-step. */
  PlayerPre?: ComponentType<AddonPlayerProps<E>>;
  /** TV above the question (question + reveal). */
  HostBanner?: ComponentType<AddonHostProps<E>>;
  /** Phone above the options / in the reveal. */
  PlayerBanner?: ComponentType<AddonPlayerProps<E>>;
  /** Chip next to a player's name in the reveal list (e.g. the wager). */
  revealTag?: (state: KnowledgePublicState<E>, player: PublicPlayer) => ReactNode;
  /** Reveal list: the answer column for a player (undefined → the answer or "keine Antwort"). */
  revealAnswer?: (state: KnowledgePublicState<E>, player: PublicPlayer) => ReactNode | undefined;
  /** Reveal list: the points column instead of "+100" (e.g. a pot that grows). */
  revealPoints?: (state: KnowledgePublicState<E>, player: PublicPlayer) => ReactNode;
  /** Reveal list: the avatar's face (e.g. cheering, disappointed). */
  revealExpression?: (state: KnowledgePublicState<E>, player: PublicPlayer) => PhotoExpression;
  /** Phone: this player sits the step out (e.g. cashed out) – PlayerSidelined shows instead of the pre-step, question and reveal. */
  sidelined?: (state: KnowledgePublicState<E>, meId: string) => boolean;
  PlayerSidelined?: ComponentType<AddonPlayerProps<E>>;
  /** Phone: own result at the reveal instead of the points (the correct answer is still shown). */
  PlayerReveal?: ComponentType<AddonPlayerProps<E>>;
}

export function CategoryChip({ category, big = false }: { category: KnowledgeCategory | null; big?: boolean }) {
  if (!category) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 border-bulb bg-petrol-dark/85 font-bold whitespace-nowrap ${
        big ? "fs-lg px-5 py-[0.8vh]" : "fs-md px-4 py-[0.6vh]"
      }`}
    >
      <span>{CATEGORY_EMOJI[category]}</span>
      <span>{KNOWLEDGE_CATEGORY_LABELS[category]}</span>
    </span>
  );
}

/** Phones: the category chip (not fluid-sized). */
export function PhoneCategoryChip({ category }: { category: KnowledgeCategory | null }) {
  if (!category) return null;
  return (
    <span className="self-center rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-1 text-lg font-bold">
      {CATEGORY_EMOJI[category]} {KNOWLEDGE_CATEGORY_LABELS[category]}
    </span>
  );
}

/** Pre-step on the TV: who has acted already (never what). */
export function ActedStrip({ state, room }: { state: KnowledgePublicState<unknown>; room: PublicRoomState }) {
  return <AnsweredStrip state={{ ...state, answeredPlayerIds: state.actedPlayerIds }} room={room} />;
}

export function PreCountdown({ state, size = "lg" }: { state: KnowledgePublicState<unknown>; size?: "lg" | "sm" }) {
  return <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} size={size} />;
}

function makeHostView<E>(addon: KnowledgeAddon<E>) {
  return function KnowledgeHostView({ state, room, sendAction }: HostViewProps<KnowledgePublicState<E>>) {
    if (state.step === "leaderboard") return <QuestionLeaderboard state={state} room={room} variant="tv" />;
    if (!state.question) {
      const Pre = addon.HostPre;
      return Pre ? <Pre state={state} room={room} sendAction={sendAction} /> : null;
    }
    const reveal = state.reveal;
    const correct = reveal?.correctIndex;
    const Banner = addon.HostBanner;

    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-[2.2vh]">
        <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
          <QuestionCounter state={state} />
          <CategoryChip category={state.category} />
          {!reveal && (
            <div className="flex-1">
              <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} />
            </div>
          )}
        </div>

        {Banner && <Banner state={state} room={room} sendAction={sendAction} />}

        <h2 className="panel fs-title shrink-0 px-[2vw] py-[2.2vh] text-center font-bold text-balance">
          {state.question.text}
        </h2>

        <div className={`grid min-h-0 flex-1 gap-[1.5vw] ${reveal ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
          <ul className="grid content-start gap-[2vh] sm:grid-cols-2">
            {state.question.options.map((option, i) => {
              const style = QUIZ_OPTION_STYLES[i]!;
              const isCorrect = correct === i;
              const pickedBy = reveal ? room.players.filter((p) => reveal.answers[p.id] === i) : [];
              return (
                <li
                  key={i}
                  className={`flex min-h-[12vh] flex-col justify-center gap-[1vh] rounded-[2rem] border-4 border-bulb px-[1.5vw] py-[1.6vh] transition duration-500 ${style.bg} ${style.shadow} ${
                    reveal && !isCorrect ? "scale-95 opacity-30 grayscale" : ""
                  } ${reveal && isCorrect ? "scale-105 ring-8 ring-cream/90" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <span className="fs-xl opacity-80">{style.shape}</span>
                    <span className="fs-xl font-bold">{option}</span>
                    {isCorrect && <span className="fs-title ml-auto">✅</span>}
                  </div>
                  {pickedBy.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pickedBy.map((p) => (
                        <AvatarBadge key={p.id} avatar={p.avatar} size="fluidSm" className="animate-pop" />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {reveal && state.question && (
            <RevealTable
              room={room}
              results={reveal.results}
              renderTag={addon.revealTag ? (p) => addon.revealTag!(state, p) : undefined}
              renderPoints={addon.revealPoints ? (p) => addon.revealPoints!(state, p) : undefined}
              expressionOf={addon.revealExpression ? (p) => addon.revealExpression!(state, p) : undefined}
              renderAnswer={(p) => {
                const own = addon.revealAnswer?.(state, p);
                if (own !== undefined) return own;
                const a = reveal.answers[p.id];
                if (a === undefined) return "keine Antwort";
                return `${QUIZ_OPTION_STYLES[a]?.shape ?? ""} ${state.question!.options[a]}`;
              }}
            />
          )}
        </div>

        {!reveal && <AnsweredStrip state={state} room={room} />}
      </div>
    );
  };
}

function makePlayerView<E>(addon: KnowledgeAddon<E>) {
  return function KnowledgePlayerView({ state, room, me, sendAction }: PlayerViewProps<KnowledgePublicState<E>>) {
    // Optimistic: show "sent" right away; the server state confirms it.
    const [sentFor, setSentFor] = useState<number | null>(null);
    const reveal = state.reveal;
    const Banner = addon.PlayerBanner;

    if (state.step === "leaderboard") {
      return <QuestionLeaderboard state={state} room={room} variant="phone" meId={me.id} />;
    }

    const Sidelined = addon.PlayerSidelined;
    if (Sidelined && addon.sidelined?.(state, me.id)) return <Sidelined state={state} room={room} me={me} sendAction={sendAction} />;

    if (!state.question) {
      const Pre = addon.PlayerPre;
      return Pre ? <Pre state={state} room={room} me={me} sendAction={sendAction} /> : null;
    }

    if (reveal) {
      const mine = reveal.answers[me.id];
      const correct = reveal.correctIndex;
      const solution = (
        <>
          <p className="text-xl">
            Richtig war:{" "}
            <span className="font-bold text-bulb">
              {QUIZ_OPTION_STYLES[correct]?.shape} {state.question.options[correct]}
            </span>
          </p>
          {mine !== undefined && mine !== correct && (
            <p className="text-lg text-cream/60">Deine Antwort: {state.question.options[mine]}</p>
          )}
        </>
      );
      const OwnReveal = addon.PlayerReveal;
      if (OwnReveal) {
        return (
          <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
            <OwnReveal state={state} room={room} me={me} sendAction={sendAction} />
            {solution}
            <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
          </div>
        );
      }
      return (
        <PlayerRevealResult result={reveal.results[me.id]} answered={mine !== undefined}>
          {Banner && <Banner state={state} room={room} me={me} sendAction={sendAction} />}
          {solution}
        </PlayerRevealResult>
      );
    }

    const answered = state.myAnswer !== null || sentFor === state.index;

    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <Countdown startedAt={state.questionStartedAt} endsAt={state.stepEndsAt} size="sm" />
        <PhoneCategoryChip category={state.category} />
        {Banner && <Banner state={state} room={room} me={me} sendAction={sendAction} />}
        <p className="panel px-5 py-4 text-center text-2xl leading-snug font-bold text-balance">{state.question.text}</p>
        {answered ? (
          <div className="flex flex-1 items-center justify-center">
            <AnswerSent>
              {state.myAnswer !== null && (
                <p className="text-xl">
                  {QUIZ_OPTION_STYLES[state.myAnswer]?.shape} {state.question.options[state.myAnswer]}
                </p>
              )}
            </AnswerSent>
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-4">
            {state.question.options.map((option, i) => {
              const style = QUIZ_OPTION_STYLES[i]!;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSentFor(state.index);
                    sendAction({ type: "answer", value: i });
                  }}
                  className={`flex min-h-20 items-center gap-4 rounded-[2rem] border-4 border-bulb px-5 py-4 text-left text-2xl font-bold transition active:translate-y-1 active:shadow-none ${style.bg} ${style.shadow}`}
                >
                  <span className="text-3xl opacity-80">{style.shape}</span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };
}

/** Music: the pre-step keeps the tension of the question (think loop). */
export function knowledgeAudio(state: { step?: string; index?: number } | null): ModuleAudioScene | null {
  if (state?.step === "pick" || state?.step === "decide" || state?.step === "wager") {
    return { key: `${state.step}:${state.index ?? 0}`, music: "think" };
  }
  // The choices are uncovered: a short sting, the tension stays.
  if (state?.step === "showdown") return { key: `showdown:${state.index ?? 0}`, music: "think", enter: "sting-short" };
  return questionRoundAudio(state);
}

export function knowledgeViews<E>(addon: KnowledgeAddon<E> = {}): GameViews<KnowledgePublicState<E>> {
  return { HostView: makeHostView(addon), PlayerView: makePlayerView(addon), audio: knowledgeAudio };
}
