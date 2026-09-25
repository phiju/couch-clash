"use client";

import type { QuestionRoundPublicState, ScoreResult } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { Leaderboard } from "@/components/leaderboard";
import { useServerNow } from "@/lib/clock";

/** What the shared pieces need of a question-based category's state. */
type AnyRoundState = Pick<QuestionRoundPublicState<unknown, unknown, unknown>, "index" | "total" | "answeredPlayerIds">;

/** "+100", "−200", "+0" – risk games can take points away. */
export function signedPoints(points: number): string {
  return points < 0 ? `−${Math.abs(points)}` : `+${points}`;
}

function pointsColor(points: number | undefined): string {
  if (points === undefined || points === 0) return "text-cream/40";
  return points > 0 ? "text-bulb" : "text-orange";
}

/** Shrinking bar + seconds left. Uses the server clock. */
export function Countdown({
  startedAt,
  endsAt,
  size = "lg",
}: {
  startedAt: number;
  endsAt: number;
  size?: "lg" | "sm";
}) {
  const now = useServerNow(200);
  const total = Math.max(1, endsAt - startedAt);
  const left = Math.max(0, endsAt - now);
  const fraction = left / total;
  const seconds = Math.ceil(left / 1000);
  const urgent = seconds <= 5;
  return (
    <div className="flex w-full items-center gap-4">
      <div
        className={`flex-1 overflow-hidden rounded-full border-2 border-bulb/60 bg-petrol-dark/80 ${size === "lg" ? "h-[clamp(0.9rem,2.4vh,1.75rem)]" : "h-4"}`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-200 ease-linear ${urgent ? "from-rust to-orange" : "from-orange to-bulb"}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`text-right font-bold tabular-nums drop-shadow-[0_3px_0_var(--color-brown)] ${size === "lg" ? "fs-title w-[3ch]" : "w-16 text-2xl"} ${urgent ? "text-orange" : "text-bulb"}`}
      >
        {seconds}
      </span>
    </div>
  );
}

export function QuestionCounter({ state }: { state: AnyRoundState }) {
  return (
    <span className="fs-md shrink-0 rounded-full border-2 border-bulb bg-petrol-dark/85 px-4 py-[0.6vh] font-bold whitespace-nowrap">
      Frage {state.index + 1} / {state.total}
    </span>
  );
}

/** Avatars of everyone; those who answered pop up, others stay dimmed. Never shows what. */
export function AnsweredStrip({ state, room }: { state: AnyRoundState; room: PublicRoomState }) {
  const answered = new Set(state.answeredPlayerIds);
  return (
    <div className="panel flex shrink-0 flex-wrap items-center justify-center gap-[1vw] self-center px-[1.5vw] py-[1.2vh]">
      {room.players.map((p) => (
        <div key={p.id} className="flex flex-col items-center gap-1">
          <AvatarBadge
            avatar={p.avatar}
            size="fluidSm"
            dimmed={!answered.has(p.id)}
            offline={!p.connected}
            className={answered.has(p.id) ? "animate-pop" : ""}
          />
          <span className={`fs-sm max-w-[9rem] truncate font-bold ${answered.has(p.id) ? "" : "text-cream/40"}`}>
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatModifier(m: number): string {
  return m.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "80 Punkte × 1,25 Tempo = 100" – only when a speed modifier applied. */
export function breakdownText(r: ScoreResult): string {
  if (r.finalScore === 0 || r.speedModifier === 1) return "";
  return `${r.baseScore} Punkte × ${formatModifier(r.speedModifier)} Tempo = ${r.finalScore}`;
}

/** Reveal list: every player, their answer, points and breakdown – best first. */
export function RevealTable({
  room,
  results,
  renderAnswer,
  renderTag,
}: {
  room: PublicRoomState;
  results: Record<string, ScoreResult>;
  renderAnswer: (player: PublicPlayer) => React.ReactNode;
  /** Optional chip next to the name (e.g. "DOUBLE", the wager). */
  renderTag?: (player: PublicPlayer) => React.ReactNode;
}) {
  const sorted = [...room.players].sort(
    (a, b) => (results[b.id]?.finalScore ?? -0.5) - (results[a.id]?.finalScore ?? -0.5),
  );
  return (
    <ul className="grid min-h-0 w-full content-start gap-[1vh] overflow-y-auto">
      {sorted.map((p, i) => {
        const r = results[p.id];
        const text = r ? breakdownText(r) : "";
        const tag = renderTag?.(p);
        return (
          <li
            key={p.id}
            className="flex animate-pop items-center gap-[1vw] rounded-2xl chip px-[1vw] py-[0.9vh]"
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
          >
            <AvatarBadge avatar={p.avatar} size="fluidSm" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="fs-lg flex flex-wrap items-center gap-[0.5vw] leading-tight font-bold [overflow-wrap:anywhere]">
                {p.name}
                {tag}
              </span>
              <span className="fs-md truncate text-cream/70">{renderAnswer(p)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className={`fs-xl font-bold ${pointsColor(r?.finalScore)}`}>{signedPoints(r?.finalScore ?? 0)}</span>
              {text && <span className="fs-sm text-cream/60">{text}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Phone: after answering. */
export function AnswerSent({ children }: { children?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-4 p-6 text-center">
      <div className="animate-float text-7xl">📨</div>
      <p className="text-3xl font-bold text-bulb">Antwort gesendet</p>
      {children}
      <p className="text-xl text-cream/70">Warte auf die anderen …</p>
    </div>
  );
}

/** Phone: own result at the reveal. */
export function PlayerRevealResult({
  result,
  answered = result !== undefined,
  children,
}: {
  result: ScoreResult | undefined;
  /** Default: there is a result. Risk games also score players who did not answer. */
  answered?: boolean;
  children?: React.ReactNode;
}) {
  const points = result?.finalScore ?? 0;
  const breakdown = result ? breakdownText(result) : "";
  return (
    <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
      <div className="animate-pop text-8xl">{points > 0 ? "🎉" : points < 0 ? "💸" : answered ? "😬" : "⏰"}</div>
      <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : points < 0 ? "text-orange" : "text-cream/60"}`}>
        {signedPoints(points)}
      </p>
      {breakdown && <p className="text-lg text-cream/80">{breakdown}</p>}
      {!answered && <p className="text-xl text-cream/70">Keine Antwort abgegeben</p>}
      {children}
      <p className="text-lg text-cream/60">Schau auf den Fernseher!</p>
    </div>
  );
}

/** Leaderboard step after a question – same component for TV and phones. */
export function QuestionLeaderboard({
  state,
  room,
  variant,
  meId,
}: {
  state: AnyRoundState;
  room: PublicRoomState;
  variant: "tv" | "phone";
  meId?: string;
}) {
  const entries = room.game?.leaderboard;
  if (!entries) return null;
  return (
    <div className={`flex w-full flex-col ${variant === "tv" ? "min-h-0 flex-1 gap-[2vh]" : "gap-4"}`}>
      {variant === "tv" && (
        <h2 className="fs-title shrink-0 text-center font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)]">
          Rangliste
        </h2>
      )}
      {/* key: restart the animation for every question */}
      <div className={variant === "tv" ? "panel min-h-0 flex-1 overflow-y-auto p-[2.5vh]" : ""}>
        <Leaderboard key={state.index} entries={entries} players={room.players} variant={variant} meId={meId} />
      </div>
    </div>
  );
}
