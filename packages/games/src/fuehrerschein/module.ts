import { FUEHRERSCHEIN_QUESTIONS_DE, FuehrerscheinQuestionSchema, type FuehrerscheinQuestion } from "@couch-clash/content";
import { playablePool } from "../content-pool";
import { createQuizLikeModule } from "../quiz/module";
import { buildExam, examDurationMs, examFacts } from "./exam";
import { FUEHRERSCHEIN_CONFIG, fuehrerscheinMeta } from "./meta";
import { driveOrder } from "./order";
import { pickMixed } from "./pick";
import type { ExamSummary } from "./types";

/** Führerscheinprüfung = the quiz with pictures, explanations and an exam result at the end. */
export function createFuehrerscheinModule(pool: readonly FuehrerscheinQuestion[] = FUEHRERSCHEIN_QUESTIONS_DE) {
  return createQuizLikeModule<FuehrerscheinQuestion, ExamSummary>({
    meta: fuehrerscheinMeta,
    schema: FuehrerscheinQuestionSchema,
    pool,
    pick: (all, ctx, options) =>
      pickMixed(playablePool(all, FuehrerscheinQuestionSchema, options, fuehrerscheinMeta), options, ctx.random),
    prepare: (prepared, source) => {
      if (source.media?.kind !== "scene") return prepared;
      const order = driveOrder(source.media, source.text, source.options[source.correctIndex]!);
      return order ? { ...prepared, driveOrder: order } : prepared;
    },
    questionSeconds: (q) => (q.media?.kind === "scene" ? FUEHRERSCHEIN_CONFIG.sceneSeconds : fuehrerscheinMeta.secondsPerQuestion),
    revealMs: (q) => (q.media?.kind === "scene" ? FUEHRERSCHEIN_CONFIG.sceneRevealMs : FUEHRERSCHEIN_CONFIG.revealMs),
    highlights: (q, answers) => {
      const all = Object.values(answers);
      const out: string[] = [];
      if (all.length > 0 && all.every((a) => a.correct)) out.push('Alle richtig – z. B. "Alle bestanden – der TÜV ist stolz auf euch."');
      if (q.media?.kind === "scene" && all.some((a) => !a.correct)) {
        out.push(
          'Kreuzungs-Frage: Wer hier falsch lag, bekommt einen Fahrlehrer-Spruch übers Autofahren, z. B. "Max, bitte gib deinen Führerschein freiwillig ab." oder "Tina, zurück in die Fahrschule – Stunde eins."',
        );
      }
      return out;
    },
    summary: { build: buildExam, durationMs: examDurationMs, facts: examFacts },
  });
}

export const fuehrerscheinModule = createFuehrerscheinModule();
