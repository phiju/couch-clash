/**
 * Release notes for players and hosts ("Neuigkeiten"), newest first.
 *
 * Written for the living room, not for developers: German, short, fun, in
 * the game-show voice. Say what you can now DO or SEE in the game – never
 * technical terms. Internal changes (tests, cleanup, infrastructure) are
 * left out; small fixes become one line like "🔧 Viele kleine Verbesserungen".
 * At most ~6 items per version, each at most ~12 words.
 *
 * Good: "🎙️ Der Moderator liest jetzt die Fragen vor – und lästert danach über euch"
 * Bad:  "TTS-Pipeline für Fragen mit R2-Cache"
 *
 * Version: new feature → minor (0.9.0 → 0.10.0), fixes only → patch (0.9.0 → 0.9.1).
 */
export interface ChangelogItem {
  emoji: string;
  text: string;
}

export interface ChangelogEntry {
  /** Semver, e.g. "0.9.0". */
  version: string;
  /** Release day, YYYY-MM-DD. */
  date: string;
  title: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.12.0",
    date: "2026-09-25",
    title: "Neu: Kategorienvorgabe, Double or Nothing, Bet und Punkteklau – und aus Wissensfragen wird der Punktesammler!",
    items: [
      { emoji: "🎯", text: "Kategorienvorgabe: Wer hinten liegt, sucht die Kategorie aus" },
      { emoji: "🎲", text: "Double or Nothing: Heimlich verdoppeln – doppelt gewinnen oder doppelt verlieren" },
      { emoji: "💰", text: "Bet: Setzt eure Punkte auf die nächste Kategorie – bis ALL IN" },
      { emoji: "🦹", text: "Punkteklau: Richtig antworten und dem Spitzenreiter Punkte stibitzen" },
      { emoji: "🧠", text: "Aus Wissensfragen wird der Punktesammler – 100 Punkte pro richtiger Antwort" },
      { emoji: "📏", text: "Schätzfragen heißen jetzt „Wer ist am nächsten dran?“" },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-09-25",
    title: "Ab in die Fahrschule",
    items: [{ emoji: "🚗", text: "Neue Kategorie: Führerscheinprüfung – mit echten Verkehrsschildern und Kreuzungen. Wer fährt zuerst?" }],
  },
  {
    version: "0.10.0",
    date: "2026-09-25",
    title: "Fragen ohne Ende",
    items: [{ emoji: "📚", text: "Über 1.100 Fragen – jetzt mit viel mehr Abwechslung und neuen Kinderfragen!" }],
  },
  {
    version: "0.9.2",
    date: "2026-09-25",
    title: "Mehr Platz in der Lobby",
    items: [{ emoji: "🧹", text: "Die Einstellungen sind jetzt eingeklappt – mehr Platz für eure Mitspieler:innen" }],
  },
  {
    version: "0.9.1",
    date: "2026-09-25",
    title: "Die Couch zieht ein",
    items: [{ emoji: "🛋️", text: "Neues Couch-Icon im Browser-Tab" }],
  },
  {
    version: "0.9.0",
    date: "2026-09-25",
    title: "Bluffen mit Köpfchen",
    items: [
      { emoji: "🎭", text: "Bluff-Lexikon: Wer alle reinlegt, kassiert den vollen Bonus" },
      { emoji: "🔥", text: "60 neue, pikante Wörter – nur im Party-Modus" },
      { emoji: "🧠", text: "Gewusst! Wer die echte Erklärung kennt, glänzt auf dem Fernseher" },
      { emoji: "🎚️", text: "Punkte pro Frage kann der Host jetzt selbst einstellen" },
      { emoji: "🎉", text: "Neu: Dieses Fenster zeigt euch, was es Neues gibt" },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-09-25",
    title: "Kids, Familie oder Party?",
    items: [
      { emoji: "🧸", text: "Drei Spielmodi: Kids, Familie und Party – für jede Runde passend" },
      { emoji: "🍸", text: "Party-Modus nur für Erwachsene – mit frecherem Moderator" },
      { emoji: "🎯", text: "Schwierigkeit wählen: leicht, gemischt oder richtig schwer" },
      { emoji: "🎲", text: "Zufall plant ein ganzes Spiel – ihr sagt nur, wie lange" },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-09-25",
    title: "Das Bluff-Lexikon",
    items: [
      { emoji: "📖", text: "Neue Kategorie: Erfindet Erklärungen für Wörter, die keiner kennt" },
      { emoji: "🕵️", text: "Findet die echte Erklärung – und legt die anderen rein" },
      { emoji: "🎙️", text: "Der Moderator liest alle Erklärungen vor" },
      { emoji: "🚶", text: "Der Moderator läuft jetzt schwungvoll auf die Bühne" },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-09-25",
    title: "Bessere Fragen, schönere Lobby",
    items: [
      { emoji: "👍", text: "Gute Frage? Bewertet jede Frage mit Daumen hoch oder runter" },
      { emoji: "⚠️", text: "„Stimmt nicht?“ – meldet Fragen, die falsch sind" },
      { emoji: "♻️", text: "Schlechte Fragen fliegen raus und werden durch neue ersetzt" },
      { emoji: "✨", text: "Lobby und Startseite in neuem Glanz" },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-09-25",
    title: "Selfies und eine echte Stimme",
    items: [
      { emoji: "🤳", text: "Macht ein Selfie – und werdet zur Comicfigur im Show-Look" },
      { emoji: "⭐", text: "„Meine Figur“ merkt sich eure Figur für den nächsten Spieleabend" },
      { emoji: "🎙️", text: "Der Moderator spricht: begrüßt euch mit Namen und lästert mit" },
      { emoji: "🌶️", text: "Wie frech darf er sein? Nett, frech oder gnadenlos" },
      { emoji: "🔧", text: "Viele kleine Verbesserungen" },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-24",
    title: "Vorhang auf mit Musik",
    items: [
      { emoji: "👋", text: "Neue Willkommensseite – ein Klick und die Show beginnt" },
      { emoji: "🎵", text: "Titelmusik, Spannungsmusik und Fanfaren auf dem Fernseher" },
      { emoji: "💻", text: "Passt jetzt auch perfekt auf jeden Laptop" },
      { emoji: "⚡", text: "Schnell antworten lohnt sich: Tempo bringt Extrapunkte" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-24",
    title: "Die Show bekommt ihren Look",
    items: [
      { emoji: "🎪", text: "Retro-Bühne mit Glühbirnen und Scheinwerfern auf allen Bildschirmen" },
      { emoji: "🎬", text: "Großer Auftritt: Logo, Konfetti und euer Moderator" },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-24",
    title: "Jetzt wird gespielt",
    items: [
      { emoji: "❓", text: "Wissensfragen: Vier Antworten, eine ist richtig" },
      { emoji: "🔢", text: "Schätzfragen: Wer am nächsten dran ist, gewinnt" },
      { emoji: "🏆", text: "Animierte Rangliste nach jeder Frage – wer überholt wen?" },
      { emoji: "⚙️", text: "Kategorien und Fragenzahl direkt in der Lobby wählen" },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-24",
    title: "Die Lobby öffnet",
    items: [
      { emoji: "📺", text: "Neues Spiel auf dem Fernseher starten" },
      { emoji: "📱", text: "QR-Code scannen und mit dem Handy mitspielen" },
      { emoji: "😀", text: "Namen und Figur aussuchen – fertig ist die Spielerkarte" },
    ],
  },
];
