/**
 * The host's lines for the Survival-Finale (German). One pool per event –
 * never a single sentence. `{playerName}` lines are voiced per player at the
 * start of the finale; `{decaySeconds}` is filled with the current phase's
 * decay threshold (so "Zehn Sekunden!" never plays in phase 3).
 *
 * Tone: cheeky, smug, over-dramatic, playfully mean – never really insulting.
 * He enjoys every elevator ride towards the slime.
 */

export const MODERATOR_EVENT_TYPES = [
  "FINALE_STARTED",
  "SCORES_CONVERTED",
  "PHASE_CHANGED",
  "FAST_CORRECT",
  "WRONG_ANSWER",
  "TIME_DECAY_STARTED",
  "TIMEOUT",
  "WARNING",
  "CRITICAL",
  "NEAR_ELIMINATION",
  "COMEBACK",
  "ELIMINATED",
  "MULTIPLE_PLAYERS_CRITICAL",
  "FINAL_TWO",
  "SUDDEN_DEATH",
  "TIEBREAK",
  "WINNER",
] as const;
export type ModeratorEventType = (typeof MODERATOR_EVENT_TYPES)[number];

/**
 * Pools by event. PHASE_CHANGED has an extra pool for DEATH MODE;
 * TRANSITION_TO_CEREMONY follows the WINNER line (then the ceremony starts).
 */
export type ModeratorPoolId = ModeratorEventType | "PHASE_CHANGED_DEATH" | "TRANSITION_TO_CEREMONY";

export const SURVIVAL_LINES: Record<ModeratorPoolId, readonly string[]> = {
  FINALE_STARTED: [
    "Willkommen zum Survival-Finale! Unter euch: frischer, warmer Schleim.",
    "Jetzt wird's ernst. Und klebrig.",
    "Das Survival-Finale! Der Schleim hat extra für euch Überstunden gemacht.",
    "Meine Damen und Herren, der Schleim ist angerichtet!",
  ],
  SCORES_CONVERTED: [
    "Eure Punkte sind jetzt eure Lebensenergie. Wer vorne lag, steht höher.",
    "Wer fleißig gepunktet hat, steht schön weit oben. Alle anderen sehen den Schleim schon aus der Nähe.",
    "Aus Punkten wird Leben. Rechnen könnt ihr später.",
  ],
  PHASE_CHANGED: [
    "Nächste Phase! Ab jetzt wird's schneller.",
    "Ich drehe mal ein bisschen am Tempo.",
    "Die Uhr läuft jetzt schneller. Der Schleim übrigens auch.",
    "Neue Phase, weniger Zeit. Ich finde das großartig.",
  ],
  PHASE_CHANGED_DEATH: [
    "Death Mode! Ab jetzt kostet jede Frage fünfzig Punkte. Einfach so.",
    "Willkommen im Death Mode. Hier bleibt keiner lange trocken.",
    "Death Mode! Kein Bonus, kein Mitleid.",
  ],
  FAST_CORRECT: [
    "OOOH! Heute noch kein Schleim!",
    "PLUS 50! Wieder nach oben!",
    "{playerName} lebt!",
    "Offenbar hilft Panik beim Denken.",
    "Das war knapp!",
    "Schleim erfolgreich vermieden.",
    "Na also! Geht doch!",
    "Und wieder ein Stück weg von der Suppe!",
    "{playerName} fährt nach oben. Wie langweilig.",
  ],
  WRONG_ANSWER: [
    "Uuuund … ZWEIHUNDERT WEG!",
    "Das war eine teure Antwort.",
    "Mutig. Selbstbewusst. Komplett falsch.",
    "Eine hervorragende Antwort. Wenn sie richtig gewesen wäre.",
    "200 Punkte direkt in den Schleim.",
    "Expressfahrt nach unten!",
    "Autsch. Das ging schneller als erwartet.",
    "Das war jetzt eher ungünstig.",
    "Der Schleim bedankt sich.",
    "Autsch, {playerName}. 200 Punkte weg.",
    "{playerName}, Expressfahrt zum Schleim!",
  ],
  TIME_DECAY_STARTED: [
    "{decaySeconds} Sekunden! Ab jetzt kostet Nachdenken.",
    "{playerName} … irgendwann wäre eine Antwort nicht schlecht.",
    "Minus zehn … minus zehn … oh, das macht Spaß.",
    "Lass dir ruhig Zeit. Wir haben genug Schleim.",
    "Nachdenken ist gut. Schneller nachdenken wäre besser.",
    "Keine Hektik, {playerName}. Der Schleim wartet.",
    "Oh! Der Aufzug fährt schon.",
  ],
  TIMEOUT: [
    "Keine Antwort ist auch eine Antwort. Eine falsche.",
    "Zeit um! Und zweihundert Punkte gleich mit.",
    "{playerName} hat sich fürs Schweigen entschieden. Teuer.",
    "Tick, tack … platsch.",
  ],
  WARNING: [
    "Oh oh, {playerName} … der Schleim kommt näher.",
    "Abwärts geht's!",
    "{playerName}, du magst Schleim, oder?",
    "Nicht nach unten schauen, {playerName}!",
    "Interessante Taktik. Immer näher an den Schleim.",
    "Ich hoffe, die Schuhe sind waschbar.",
    "Die gute Nachricht: Du bist noch dabei. Die schlechte: nicht mehr lange trocken.",
    "Keine Sorge, unten ist noch Platz.",
    "Langsam wird's feucht, {playerName}.",
  ],
  CRITICAL: [
    "{playerName} … warst du schon mal im Schleim baden?",
    "Du kommst dem Boden verdächtig nahe.",
    "Ich glaube, der Schleim ruft deinen Namen.",
    "Wink den trockenen Leuten noch mal!",
    "Keine Angst. Der Schleim ist bestimmt angenehm warm.",
    "Ich würde jetzt langsam mal was wissen.",
    "Das wird knapp.",
    "Sehr knapp.",
    "SEHR, SEHR knapp.",
  ],
  NEAR_ELIMINATION: [
    "Tja … das könnte deine letzte Frage werden.",
    "{playerName}, ich würde es mir da oben nicht mehr gemütlich machen.",
    "Eine falsche Antwort und du gehst baden.",
    "Sollen wir uns schon mal von {playerName} verabschieden? … Zu früh?",
    "Ich hoffe, du hast Wechselklamotten dabei.",
    "Noch einmal falsch und … GLUB GLUB.",
  ],
  COMEBACK: [
    "Moment mal … {playerName} kommt zurück!",
    "Der Schleim wurde ABGELEHNT!",
    "Ich dachte schon, wir hätten dich verloren.",
    "Da möchte aber jemand unbedingt trocken bleiben.",
    "Nicht schlecht. Eben noch fast weg – jetzt wieder da.",
  ],
  ELIMINATED: [
    "PLATSCH!",
    "Und tschüss, {playerName}!",
    "Viel Spaß im Schleim!",
    "So kann man Couch Clash natürlich auch verlassen.",
    "Wir sehen uns nach dem Schleudergang.",
    "Kann jemand {playerName} ein Handtuch bringen?",
    "Danke fürs Mitspielen. Bitte nicht auf den Teppich tropfen.",
    "GLUB GLUB.",
    "Einer weniger!",
  ],
  MULTIPLE_PLAYERS_CRITICAL: [
    "Ui, da unten wird's aber voll!",
    "Mehrere Kandidaten in der Gefahrenzone. Ich liebe diesen Job.",
    "Der Schleim kann sich gar nicht entscheiden, wen er zuerst nimmt.",
    "So viele Aufzüge, so wenig Abstand zum Schleim. Herrlich.",
  ],
  FINAL_TWO: [
    "Zwei Kandidaten. Ein trockener Gewinner.",
    "Einer von euch geht baden.",
    "Jetzt wird's unangenehm.",
    "Nur noch zwei! Und da unten ist genug Schleim für einen von euch.",
    "Ich würde jetzt keine Fehler mehr machen.",
  ],
  SUDDEN_DEATH: [
    "Alle im Schleim? Nein, nein, nein. So billig kommt ihr mir nicht davon!",
    "Sudden Death! Raus aus der Suppe, zurück aufs Brett!",
    "Tropfnass, aber wieder im Spiel. Sudden Death!",
    "Das zählt nicht! Alle wieder hoch. Hundert Punkte, Death Mode.",
  ],
  TIEBREAK: [
    "Genug Schleim für heute. Jetzt entscheidet eine Schätzfrage!",
    "Schätzfrage! Wer am nächsten dran ist, darf trocken nach Hause.",
    "Ich geb auf. Schätzen! Wer am nächsten liegt, gewinnt.",
  ],
  WINNER: [
    "WIR HABEN EINEN ÜBERLEBENDEN!",
    "Alle anderen sind im Schleim. So sieht ein Sieg aus!",
    "{playerName} bleibt trocken!",
    "Couch Clash hat einen Gewinner!",
    "{playerName} gewinnt – und darf die Klamotten anbehalten!",
  ],
  TRANSITION_TO_CEREMONY: [
    "So, genug geplanscht. Abtrocknen und ab zur Siegerehrung!",
    "Alle Schleimigen bitte abtrocknen. Wir sehen uns bei der Siegerehrung!",
    "Handtücher gibt's am Ausgang. Ab zur Siegerehrung!",
    "Kurz abtropfen lassen – und dann ab aufs Treppchen!",
    "Die Nassen bitte abtrocknen, der Trockene bitte nach vorne. Siegerehrung!",
  ],
};

/**
 * Running gags: small stories per player that develop over the finale.
 * `start` lines open a gag; each later stage fires on a matching event of
 * the same player.
 */
export const RUNNING_GAGS = {
  /** Keeps thinking too long … and then answers wrong anyway. */
  slow: {
    stages: [
      { on: "TIME_DECAY_STARTED", text: "{playerName}, wir hatten das doch besprochen. Der Schleim ist UNTEN." },
      { on: "WRONG_ANSWER", text: "Ah. Du erinnerst dich also doch, wo er ist." },
    ],
  },
  /** "Du magst Schleim, oder?" → rescued → wrong again. */
  slimeFan: {
    start: "{playerName}, du magst Schleim, oder?",
    stages: [
      { on: "COMEBACK", also: "FAST_CORRECT", text: "Ach! Plötzlich doch kein Schleim-Fan mehr?" },
      { on: "WRONG_ANSWER", text: "WUSSTE ICH'S DOCH. Schleim-Fan." },
    ],
  },
  /** Wrong again. */
  wrongAgain: {
    stages: [{ on: "WRONG_ANSWER", text: "Schon wieder falsch, {playerName}. Langsam wird das ein Hobby." }],
  },
} as const;
export type GagId = keyof typeof RUNNING_GAGS;

export const PLAYER_NAME = "{playerName}";
export const DECAY_SECONDS = "{decaySeconds}";

/** Every text as spoken, for a given set of decay thresholds (no names). */
export function namelessLines(decaySeconds: readonly number[]): string[] {
  const out = new Set<string>();
  const gagTexts = Object.values(RUNNING_GAGS).flatMap((g) => g.stages.map((s) => s.text));
  for (const line of [...Object.values(SURVIVAL_LINES).flat(), ...gagTexts]) {
    if (line.includes(PLAYER_NAME)) continue;
    if (line.includes(DECAY_SECONDS)) for (const s of decaySeconds) out.add(fillLine(line, { decaySeconds: s }));
    else out.add(line);
  }
  return [...out];
}

export function fillLine(line: string, values: { playerName?: string; decaySeconds?: number }): string {
  return line
    .replaceAll(PLAYER_NAME, values.playerName ?? "")
    .replaceAll(DECAY_SECONDS, values.decaySeconds !== undefined ? String(values.decaySeconds) : "");
}
