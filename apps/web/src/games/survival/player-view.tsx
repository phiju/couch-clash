"use client";

import type { SurvivalPublicState } from "@couch-clash/games/meta";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useServerNow } from "@/lib/clock";
import { signedPoints } from "../question-round/components";
import { QUIZ_OPTION_STYLES } from "../quiz/options";
import type { PlayerViewProps } from "../types";
import { liveScores, timeZone, zoneText } from "./logic";

const DANGER_TEXT: Record<string, string> = {
  SAFE: "Sicher über dem Schleim",
  WARNING: "Es wird ungemütlich",
  CRITICAL: "Kritisch – nah am Schleim!",
  ELIMINATION_IMMINENT: "Eine falsche Antwort und du gehst baden!",
  ELIMINATED: "Im Schleim",
};

export function SurvivalPlayerView({ state, room, me, sendAction }: PlayerViewProps<SurvivalPublicState>) {
  const now = useServerNow(200);
  const [sentFor, setSentFor] = useState<number | null>(null);
  const mine = state.players.find((p) => p.id === me.id);
  const q = state.question;
  const score = liveScores(state, now)[me.id] ?? mine?.score ?? 0;

  // Not part of the finale (joined later): just watch.
  if (!mine) {
    return <Watching text="Das Survival-Finale läuft – schau auf den Fernseher!" />;
  }

  const header = (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${state.phase.id === "death" ? "bg-rust" : "chip text-bulb"}`}>
          🟢 {state.phase.label}
        </span>
        {q && state.step === "question" && (
          <span className="text-sm font-bold text-cream/70">Frage {q.number}</span>
        )}
      </div>
      <div className={`panel flex items-center justify-between px-5 py-3 ${mine.eliminated ? "opacity-70" : ""}`}>
        <div className="flex flex-col">
          <span className="text-sm text-cream/70">Deine Lebensenergie</span>
          <span className="text-sm font-bold text-cream/80">{DANGER_TEXT[mine.eliminated ? "ELIMINATED" : mine.danger]}</span>
        </div>
        <span
          className={`text-5xl font-bold tabular-nums ${
            mine.danger === "CRITICAL" || mine.danger === "ELIMINATION_IMMINENT" ? "animate-pulse text-orange" : "text-bulb"
          }`}
        >
          {score.toLocaleString("de-DE")}
        </span>
      </div>
    </div>
  );

  if (state.step === "intro") {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {header}
        <div className="panel flex flex-col gap-2 px-5 py-4 text-center">
          <p className="text-2xl font-bold text-bulb">SURVIVAL-FINALE</p>
          <p className="text-lg">
            Deine {mine.mainScore.toLocaleString("de-DE")} Punkte werden zu {mine.startScore.toLocaleString("de-DE")} Lebensenergie.
          </p>
          <ul className="text-base text-cream/90">
            <li>Richtig bis {state.phase.speedBonusThreshold} s: +{state.phase.speedBonus}</li>
            <li>Ab {state.phase.scoreDecayThreshold} s: −{state.rules.scoreDecayPerSecond} pro Sekunde</li>
            <li>Falsch oder keine Antwort: −{state.rules.wrongAnswerPenalty}</li>
            <li>0 Punkte: raus. Der Letzte gewinnt.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (state.step === "winner") {
    const place = state.ranking?.find((r) => r.playerId === me.id)?.place;
    const won = state.winnerId === me.id;
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-6xl">{won ? "🏆" : "🟢"}</p>
        <p className="text-3xl font-bold text-bulb">{won ? "Du bleibst trocken – du gewinnst!" : place ? `Platz ${place}` : "Vorbei!"}</p>
        {!won && <p className="text-lg text-cream/80">Schau auf den Fernseher – gleich kommt die Siegerehrung.</p>}
      </div>
    );
  }

  if (state.step === "tiebreak" || state.step === "tiebreak_reveal") {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {header}
        <Tiebreak state={state} meId={me.id} sendAction={sendAction} />
      </div>
    );
  }

  if (mine.eliminated) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {header}
        <div className="panel flex flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
          <p className="text-6xl">🫧</p>
          <p className="text-4xl font-bold text-orange">ELIMINIERT</p>
          <p className="text-lg text-cream/80">Du bist im Schleim. Bleib dran und schau zu, wer als Nächstes baden geht!</p>
        </div>
      </div>
    );
  }

  if (state.step === "phase_change" || state.step === "sudden_death") {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {header}
        <div className="panel flex flex-1 flex-col items-center justify-center gap-2 px-5 py-6 text-center">
          <p className="text-4xl font-bold text-orange">{state.step === "sudden_death" ? "SUDDEN DEATH" : state.phase.label}</p>
          <p className="text-lg">
            {state.phase.speedBonus > 0
              ? `Bonus bis ${state.phase.speedBonusThreshold} s · Verfall ab ${state.phase.scoreDecayThreshold} s · Schluss nach ${state.phase.questionTimeout} s`
              : `Kein Bonus · −${state.phase.baseDrain} für alle nach jeder Frage · Schluss nach ${state.phase.questionTimeout} s`}
          </p>
        </div>
      </div>
    );
  }

  if (!q) return <div className="flex w-full flex-1 flex-col gap-4">{header}</div>;

  const change = mine.change;
  const answered = mine.answered || sentFor === q.number;
  const zone = timeZone(q, now);

  if (state.step === "reveal") {
    const correct = state.reveal?.correctIndex ?? 0;
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {header}
        <ChangeCard change={change} answered={mine.answered} />
        <p className="text-center text-xl">
          Richtig war:{" "}
          <span className="font-bold text-bulb">
            {QUIZ_OPTION_STYLES[correct]?.shape} {q.options[correct]}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {header}
      {!answered && (
        <div className="flex items-center justify-between gap-3">
          <span
            className={`rounded-full px-3 py-1 text-base font-bold ${
              zone === "bonus" ? "bg-bulb text-brown" : zone === "decay" ? "animate-pulse bg-rust" : "chip"
            }`}
          >
            {zoneText(zone, q, state.rules.scoreDecayPerSecond)}
          </span>
          <span className={`text-3xl font-bold tabular-nums ${zone === "decay" ? "text-orange" : "text-bulb"}`}>
            {Math.max(0, Math.ceil((q.timeoutAt - now) / 1000))}
          </span>
        </div>
      )}
      <p className="panel px-5 py-4 text-center text-2xl leading-snug font-bold text-balance">{q.text}</p>
      {answered ? (
        <ChangeCard change={change} answered />
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-3">
          {q.options.map((option, i) => {
            const style = QUIZ_OPTION_STYLES[i]!;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSentFor(q.number);
                  sendAction({ type: "answer", value: i });
                }}
                className={`flex min-h-16 items-center gap-4 rounded-[2rem] border-4 border-bulb px-5 py-3 text-left text-2xl font-bold transition active:translate-y-1 active:shadow-none ${style.bg} ${style.shadow}`}
              >
                <span className="text-3xl opacity-80">{style.shape}</span>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
      )}
      {!answered && <p className="text-center text-sm text-cream/60">Nur eine Antwort! Falsch kostet −{state.rules.wrongAnswerPenalty}.</p>}
      <span className="sr-only">{room.code}</span>
    </div>
  );
}

/** After answering: locked, with what it did (the server's numbers). */
function ChangeCard({ change, answered }: { change: SurvivalPublicState["players"][number]["change"]; answered: boolean }) {
  if (!change) {
    return (
      <div className="panel px-5 py-4 text-center text-xl font-bold">{answered ? "Antwort gesperrt – mal sehen …" : "Keine Antwort"}</div>
    );
  }
  const wrong = change.penalty > 0;
  const parts = [
    change.bonus > 0 ? `Schnellantwort +${change.bonus}` : null,
    change.decay > 0 ? `Zeit −${change.decay}` : null,
    wrong ? (answered ? `Falsch −${change.penalty}` : `Keine Antwort −${change.penalty}`) : null,
    change.drain > 0 ? `Death Mode −${change.drain}` : null,
  ].filter(Boolean);
  return (
    <div className={`panel flex flex-col items-center gap-1 px-5 py-4 text-center ${wrong ? "ring-4 ring-orange" : change.bonus > 0 ? "ring-4 ring-bulb" : ""}`}>
      <span className={`text-5xl font-bold tabular-nums ${change.total < 0 ? "text-orange" : "text-bulb"}`}>
        {change.total === 0 ? "±0" : signedPoints(change.total)}
      </span>
      <span className="text-lg">{wrong ? "Autsch!" : change.bonus > 0 ? "Richtig und schnell!" : "Richtig!"}</span>
      {parts.length > 0 && <span className="text-sm text-cream/70">{parts.join(" · ")}</span>}
    </div>
  );
}

function Tiebreak({
  state,
  meId,
  sendAction,
}: {
  state: SurvivalPublicState;
  meId: string;
  sendAction: (action: unknown) => void;
}) {
  const tb = state.tiebreak!;
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<number | null>(null);
  const inIt = tb.participants.includes(meId);
  if (!inIt) return <Watching text="Die Schätzfrage entscheidet – schau auf den Fernseher!" />;
  if (tb.reveal) {
    const won = tb.reveal.winnerId === meId;
    return <div className="panel px-5 py-6 text-center text-3xl font-bold">{won ? "Am nächsten dran! 🏆" : "Knapp daneben …"}</div>;
  }
  const answered = tb.myAnswer !== null || sent === tb.attempt;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-lg font-bold text-orange">SCHÄTZFRAGE! Wer am nächsten dran ist, gewinnt.</p>
      <p className="panel px-5 py-4 text-center text-2xl font-bold text-balance">{tb.text}</p>
      {answered ? (
        <div className="panel px-5 py-4 text-center text-xl font-bold">Abgegeben: {tb.myAnswer ?? parsed}</div>
      ) : (
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!Number.isFinite(parsed) || value.trim() === "") return;
            setSent(tb.attempt);
            sendAction({ type: "estimate", value: parsed });
          }}
        >
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1 rounded-2xl bg-cream px-4 py-3 text-2xl font-bold text-brown"
            placeholder={tb.unit ? `in ${tb.unit}` : "Deine Schätzung"}
            aria-label="Deine Schätzung"
          />
          <Button type="submit" className="px-6 text-xl">
            OK
          </Button>
        </form>
      )}
    </div>
  );
}

function Watching({ text }: { text: string }) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-6xl">🟢</p>
      <p className="text-xl">{text}</p>
    </div>
  );
}
