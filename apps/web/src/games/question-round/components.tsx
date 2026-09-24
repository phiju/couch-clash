"use client";

import type { PointsBreakdown, QuestionRoundPublicState } from "@couch-clash/games/meta";
import type { PublicPlayer, PublicRoomState } from "@couch-clash/shared";
import { AvatarBadge } from "@/components/avatar";
import { Leaderboard } from "@/components/leaderboard";
import { useServerNow } from "@/lib/clock";
import { formatPercent } from "@/lib/numbers";

type AnyRoundState = QuestionRoundPublicState<unknown, unknown, unknown>;

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
        className={`flex-1 overflow-hidden rounded-full border-2 border-bulb/60 bg-petrol-dark/80 ${size === "lg" ? "h-7" : "h-4"}`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-200 ease-linear ${urgent ? "from-rust to-orange" : "from-orange to-bulb"}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`w-16 text-right font-bold tabular-nums drop-shadow-[0_3px_0_var(--color-brown)] ${size === "lg" ? "text-5xl" : "text-2xl"} ${urgent ? "text-orange" : "text-bulb"}`}
      >
        {seconds}
      </span>
    </div>
  );
}

export function QuestionCounter({ state }: { state: AnyRoundState }) {
  return (
    <span className="rounded-full border-2 border-bulb bg-petrol-dark/85 px-5 py-1.5 text-xl font-bold lg:text-2xl">
      Frage {state.index + 1} / {state.total}
    </span>
  );
}

/** Avatars of everyone; those who answered pop up, others stay dimmed. Never shows what. */
export function AnsweredStrip({ state, room }: { state: AnyRoundState; room: PublicRoomState }) {
  const answered = new Set(state.answeredPlayerIds);
  return (
    <div className="panel flex flex-wrap items-center justify-center gap-4 self-center px-6 py-4">
      {room.players.map((p) => (
        <div key={p.id} className="flex flex-col items-center gap-1">
          <AvatarBadge
            avatar={p.avatar}
            size="sm"
            dimmed={!answered.has(p.id)}
            className={answered.has(p.id) ? "animate-pop" : ""}
          />
          <span className={`max-w-24 truncate text-sm font-bold ${answered.has(p.id) ? "" : "text-cream/40"}`}>
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}

export function breakdownText(r: PointsBreakdown, showSpeed: boolean, accuracyLabel: string): string {
  if (r.points === 0) return "";
  const parts = [`${formatPercent(r.accuracy)} ${accuracyLabel}`];
  if (showSpeed) parts.push(`${formatPercent(r.speed)} Tempo`);
  return parts.join(" × ");
}

/** Reveal list: every player, their answer, points and breakdown – best first. */
export function RevealTable({
  room,
  results,
  renderAnswer,
  accuracyLabel,
  showAccuracy,
}: {
  room: PublicRoomState;
  results: Record<string, PointsBreakdown>;
  renderAnswer: (player: PublicPlayer) => React.ReactNode;
  accuracyLabel: string;
  showAccuracy: boolean;
}) {
  const sorted = [...room.players].sort(
    (a, b) => (results[b.id]?.points ?? -1) - (results[a.id]?.points ?? -1),
  );
  const showSpeed = Object.values(results).some((r) => r.points > 0 && r.speed < 1);
  return (
    <ul className="grid w-full content-start gap-3">
      {sorted.map((p, i) => {
        const r = results[p.id];
        const text = r && (showAccuracy || showSpeed) ? breakdownText(r, showSpeed, accuracyLabel) : "";
        return (
          <li
            key={p.id}
            className="flex animate-pop items-center gap-4 rounded-2xl chip px-4 py-3"
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
          >
            <AvatarBadge avatar={p.avatar} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-2xl font-bold">{p.name}</span>
              <span className="truncate text-lg text-cream/70">{renderAnswer(p)}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className={`text-3xl font-bold ${r && r.points > 0 ? "text-bulb" : "text-cream/40"}`}>
                +{r?.points ?? 0}
              </span>
              {text && <span className="text-sm text-cream/60">{text}</span>}
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
  children,
}: {
  result: PointsBreakdown | undefined;
  children?: React.ReactNode;
}) {
  const points = result?.points ?? 0;
  return (
    <div className="panel flex w-full flex-col items-center gap-4 p-6 text-center">
      <div className="animate-pop text-8xl">{points > 0 ? "🎉" : result ? "😬" : "⏰"}</div>
      <p className={`text-6xl font-bold ${points > 0 ? "text-bulb" : "text-cream/60"}`}>+{points}</p>
      {!result && <p className="text-xl text-cream/70">Keine Antwort abgegeben</p>}
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
    <div className="flex w-full flex-col gap-4">
      {variant === "tv" && (
        <h2 className="text-center text-5xl font-bold text-bulb drop-shadow-[0_6px_0_var(--color-brown)] lg:text-6xl">
          Rangliste
        </h2>
      )}
      {/* key: restart the animation for every question */}
      <div className={variant === "tv" ? "panel p-6" : ""}>
        <Leaderboard key={state.index} entries={entries} players={room.players} variant={variant} meId={meId} />
      </div>
    </div>
  );
}
