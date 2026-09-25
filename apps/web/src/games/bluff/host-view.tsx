"use client";

import { OPTION_LETTERS, type BluffPublicState } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { useHostSpeech } from "@/components/host/voice";
import { useServerNow } from "@/lib/clock";
import { AnsweredStrip, Countdown, QuestionLeaderboard } from "../question-round/components";
import type { HostViewProps } from "../types";
import { foolText, presentHighlight } from "./logic";
import type { BluffUiTexts } from "./texts";

function WordCounter({ state, label }: { state: BluffPublicState; label: string }) {
  return (
    <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
      {label} {state.index + 1} / {state.total}
    </span>
  );
}

/** The TV view of the bluff engine, with the texts of one game. */
export function createBluffHostView(texts: BluffUiTexts) {
  return function HostView(props: HostViewProps<BluffPublicState>) {
    return <BluffHostView {...props} texts={texts} />;
  };
}

function BluffHostView({ state, room, texts }: HostViewProps<BluffPublicState> & { texts: BluffUiTexts }) {
  if (state.step === "leaderboard") {
    return <QuestionLeaderboard state={{ ...state, answeredPlayerIds: [] } as never} room={room} variant="tv" />;
  }
  const timed = state.step === "write" || state.step === "vote";
  const compactWord = state.options !== null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2vh]">
      <div className="flex shrink-0 items-center justify-between gap-[1.5vw]">
        <WordCounter state={state} label={texts.counter} />
        {timed && (
          <div className="flex-1">
            <Countdown startedAt={state.stepStartedAt} endsAt={state.stepEndsAt} />
          </div>
        )}
      </div>

      {state.story ? (
        <StoryCard state={state} story={state.story} compact={compactWord} hint={texts.hints[state.step]} />
      ) : (
        <div className={`panel flex shrink-0 flex-col items-center text-center ${compactWord ? "gap-[0.5vh] px-[2vw] py-[1.4vh]" : "gap-[2vh] px-[2vw] py-[5vh]"}`}>
          <h2
            className={`font-bold tracking-wide text-bulb drop-shadow-[0_6px_0_var(--color-brown)] [overflow-wrap:anywhere] ${state.step === "solution" ? "fs-xl" : compactWord ? "fs-title" : "fs-hero animate-pop"}`}
          >
            {state.step === "solution" && state.reveal ? (
              <>
                {state.reveal.lead} <span className="text-cream">{state.reveal.definition}</span>
              </>
            ) : (
              state.question
            )}
          </h2>
          {state.step !== "solution" && (
            <p className={`${compactWord ? "fs-md" : "fs-xl"} text-cream/85`}>{texts.hints[state.step]}</p>
          )}
        </div>
      )}

      {state.step === "write" && <AnsweredStrip state={{ ...state, answeredPlayerIds: state.submittedPlayerIds } as never} room={room} />}
      {state.step === "check" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="fs-hero animate-float">🔎</div>
        </div>
      )}
      {state.options && <Options state={state} room={room} />}
      {state.step === "vote" && (
        <AnsweredStrip state={{ ...state, answeredPlayerIds: state.votedPlayerIds } as never} room={room} />
      )}
    </div>
  );
}

/**
 * Skurrile Ereignisse: the start of the story in a big readable card, the
 * question highlighted below, the year as a badge. At the solution: the
 * truth, the fact behind it and the source (domain only – no link on a TV).
 */
function StoryCard({
  state,
  story,
  compact,
  hint,
}: {
  state: BluffPublicState;
  story: NonNullable<BluffPublicState["story"]>;
  compact: boolean;
  hint: string | undefined;
}) {
  const reveal = state.reveal;
  if (state.step === "solution" && reveal) {
    return (
      <div className="panel flex shrink-0 flex-col items-center gap-[0.6vh] px-[2.5vw] py-[1.2vh] text-center">
        <h2 className="fs-xl font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)] [overflow-wrap:anywhere]">
          {reveal.lead} <span className="text-cream">{reveal.definition}</span>
        </h2>
        {reveal.extra && (
          <>
            <p className="fs-md max-w-[80ch] leading-snug text-cream/90">{reveal.extra.fact}</p>
            {reveal.extra.source && <p className="fs-sm text-cream/60">Quelle: {reveal.extra.source}</p>}
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className={`panel flex shrink-0 flex-col items-center text-center ${compact ? "gap-[0.8vh] px-[2.5vw] py-[1.4vh]" : "gap-[2vh] px-[3vw] py-[3.5vh]"}`}
    >
      {story.year !== null && (
        <span className="fs-sm rounded-full bg-bulb px-3 py-0.5 font-bold text-brown">{story.year}</span>
      )}
      <p className={`${compact ? "fs-md" : "fs-xl animate-pop"} max-w-[60ch] leading-snug text-cream`}>{story.context}</p>
      <h2
        className={`${compact ? "fs-lg" : "fs-title"} rounded-2xl bg-petrol-dark/70 px-[1.5vw] py-[0.6vh] font-bold text-bulb drop-shadow-[0_4px_0_var(--color-brown)] [overflow-wrap:anywhere]`}
      >
        {state.question}
      </h2>
      {hint && <p className={`${compact ? "fs-sm" : "fs-md"} text-cream/85`}>{hint}</p>}
    </div>
  );
}

function Options({ state, room }: { state: BluffPublicState; room: PublicRoomState }) {
  const now = useServerNow(250);
  const speech = useHostSpeech();
  const highlight = presentHighlight(state, now, speech?.cue);
  const reveal = state.reveal;
  const solution = state.step === "solution";
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const people = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const options = state.options!;
  const twoColumns = options.length > 4;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.5vh]">
      <ul className={`grid min-h-0 flex-1 content-start gap-[1.4vh] overflow-y-auto ${twoColumns ? "lg:grid-cols-2" : ""}`}>
        {options.map((o, i) => {
          const r = reveal?.options[i];
          const isReal = !!r?.correct;
          const read = highlight === i;
          const heard = state.step === "present" && highlight !== null && i < highlight;
          const hidden = state.step === "present" && (highlight === null || i > highlight);
          return (
            <li
              key={i}
              className={`flex flex-col gap-[0.8vh] rounded-[1.6rem] border-4 px-[1.4vw] py-[1.2vh] transition duration-500 ${
                solution && isReal
                  ? "scale-[1.01] border-bulb bg-bulb text-brown shadow-[0_0_40px_rgba(253,188,95,0.7)]"
                  : read
                    ? "scale-[1.01] border-bulb bg-orange"
                    : "border-bulb/50 bg-petrol-dark/85"
              } ${solution && !isReal ? "opacity-50" : ""} ${hidden ? "opacity-25" : ""} ${heard ? "opacity-80" : ""}`}
            >
              <div className="flex items-start gap-[1vw]">
                <span
                  className={`fs-xl flex size-[clamp(2.2rem,5.5vh,4rem)] shrink-0 items-center justify-center rounded-full font-bold ${
                    solution && isReal ? "bg-brown text-bulb" : "bg-bulb text-brown"
                  }`}
                >
                  {OPTION_LETTERS[i]}
                </span>
                <span className="fs-lg flex-1 self-center leading-snug font-bold">{o.text}</span>
                {solution && isReal && <span className="fs-title">✅</span>}
              </div>
              {r && (
                <div className="flex flex-wrap items-center gap-x-[1.2vw] gap-y-[0.6vh] pl-[calc(clamp(2.2rem,5.5vh,4rem)+1vw)]">
                  {r.authors.length > 0 && (
                    <Authors
                      players={people(r.authors)}
                      delay={i * 350}
                      originals={reveal?.originals ?? null}
                      bonus={r.voters.length > 0 && reveal?.results[r.authors[0]!] ? foolText(reveal.results[r.authors[0]!]!) : null}
                    />
                  )}
                  {isReal && solution && reveal && reveal.knewItPlayerIds.length > 0 && (
                    <span className="fs-md flex flex-wrap items-center gap-2 font-bold">
                      🧠 Gewusst:
                      {people(reveal.knewItPlayerIds).map((p) => {
                        const res = reveal.results[p.id];
                        return (
                          <span key={p.id} className="flex items-center gap-1 rounded-full bg-brown/80 px-2 py-0.5 text-bulb">
                            <AvatarBadge avatar={p.avatar} size="xs" />
                            {p.name} {res ? `+${res.finalScore}` : ""}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {r.voters.length > 0 && <Voters players={people(r.voters)} delay={600 + i * 350} fooled={!isReal} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Authors({
  players,
  delay,
  originals,
  bonus,
}: {
  players: PublicPlayer[];
  delay: number;
  /** "+56 (5 von 9 reingelegt)" – every author of a merged option gets it. */
  bonus: string | null;
  /** Host option: what the authors really wrote (before polishing). */
  originals: Record<string, string> | null;
}) {
  return (
    <>
      <span
        className="fs-md flex animate-pop items-center gap-2 rounded-full bg-rust/90 px-3 py-1 font-bold text-cream"
        style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
      >
        ✍️ von
        {players.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <AvatarBadge avatar={p.avatar} size="xs" />
            {p.name}
          </span>
        ))}
        {bonus && <span className="text-bulb">{bonus}</span>}
      </span>
      {originals &&
        players.map((p) =>
          originals[p.id] ? (
            <span key={`o-${p.id}`} className="fs-sm basis-full text-cream/75 italic">
              {p.name} schrieb: „{originals[p.id]}“
            </span>
          ) : null,
        )}
    </>
  );
}

function Voters({ players, delay, fooled }: { players: PublicPlayer[]; delay: number; fooled: boolean }) {
  return (
    <span className="fs-md flex flex-wrap items-center gap-2 font-bold">
      <span className="opacity-80">{fooled ? "reingefallen:" : "getippt:"}</span>
      {players.map((p, k) => (
        <span
          key={p.id}
          className="flex animate-pop items-center gap-1"
          style={{ animationDelay: `${delay + k * 200}ms`, animationFillMode: "backwards" }}
        >
          <AvatarBadge avatar={p.avatar} size="fluidSm" expression={fooled ? "geschockt" : "jubelnd"} />
          {p.name}
        </span>
      ))}
    </span>
  );
}
