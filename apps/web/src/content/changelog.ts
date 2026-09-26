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
    version: "0.28.1",
    date: "2026-09-26",
    title: "Das Musik-Quiz legt los",
    items: [
      { emoji: "🎶", text: "Das Musik-Quiz ist startklar – die Songs kommen jetzt frisch von Deezer" },
      { emoji: "🔀", text: "Jede Runde neue Playlists – so schnell geht euch die Musik nicht aus" },
    ],
  },
  {
    version: "0.28.0",
    date: "2026-09-26",
    title: "Pixelpanik ist da!",
    items: [
      { emoji: "👾", text: "Pixelpanik ist spielbereit: 158 Bilder warten darauf, erkannt zu werden" },
      { emoji: "🗼", text: "Bauwerke, Tiere, Essen, Autos, Flaggen, Naturwunder und Alltagskram" },
      { emoji: "🍸", text: "Auf der Party gibt's eigene Partybilder – und jedes andere Bild auch" },
      { emoji: "🧸", text: "Im Kids-Modus mit vier Antworten zum Antippen" },
    ],
  },
  {
    version: "0.27.0",
    date: "2026-09-26",
    title: "Neues Spiel: Musik-Quiz!",
    items: [
      { emoji: "🎶", text: "Partyhits zum Mitsingen – vom Schlager bis zu den 90ern" },
      { emoji: "🔔", text: "Titel oder Interpret erkannt? Wer zuerst buzzert, darf antworten" },
      { emoji: "📅", text: "Aus welchem Jahr? Alle tippen – der Zeitstrahl verrät, wer daneben lag" },
      { emoji: "🎚️", text: "Genres selbst aussuchen oder einfach Zufall" },
      { emoji: "🧸", text: "Für Kids: Lied antippen, ganz ohne Zeitdruck" },
      { emoji: "🎙️", text: "Der Moderator kündigt jede Frage an – und lästert über Fehl-Buzzer" },
    ],
  },
  {
    version: "0.26.0",
    date: "2026-09-26",
    title: "Neues Spiel: Stadt, Land, Fluss!",
    items: [
      { emoji: "✏️", text: "Der Klassiker: ein Buchstabe, alle schreiben gleichzeitig am Handy" },
      { emoji: "🛑", text: "Alles ausgefüllt? Stopp drücken – die anderen haben nur noch 10 Sekunden" },
      { emoji: "🎙️", text: "Der Moderator liest jede Antwort vor – und lästert über Ausreißer" },
      { emoji: "👯", text: "Doppelte Antworten gibt's nur halb – Tippfehler verzeiht die Jury" },
      { emoji: "😂", text: "Stimmt ab: Die witzigste Antwort kassiert Extrapunkte" },
      { emoji: "🍹", text: "Im Party-Modus mit extra versauten Kategorien – nur für Erwachsene" },
    ],
  },
  {
    version: "0.25.0",
    date: "2026-09-26",
    title: "Double or Nothing: Kassieren oder alles riskieren?",
    items: [
      { emoji: "💰", text: "Jeder baut seinen eigenen Topf: 100 → 300 → 700 → 1.500 → 3.100" },
      { emoji: "🎲", text: "Vor jeder Frage geheim am Handy: kassieren oder weiter setzen?" },
      { emoji: "🔥", text: "Fünf Fragen, jede schwerer – ab Stufe 4 wird's richtig fies" },
      { emoji: "💥", text: "Falsch gesetzt? Topf geplatzt – und der Moderator lästert" },
      { emoji: "👀", text: "Alle Entscheidungen werden gleichzeitig aufgedeckt – Spannung pur" },
      { emoji: "🧸", text: "Im Kindermodus bleibt Stufe 5 kindgerecht schwer" },
    ],
  },
  {
    version: "0.24.0",
    date: "2026-09-26",
    title: "Survival-Finale im Schleimlabor",
    items: [
      { emoji: "🧪", text: "Neue Bühne: blubbernde Schleimtanks, Kupferrohre und grüner Nebel" },
      { emoji: "🧍", text: "Eure Figuren stehen jetzt in voller Größe auf der Plattform" },
      { emoji: "😱", text: "Sie zittern, jubeln und erschrecken – je nachdem, wie's gerade läuft" },
      { emoji: "🪧", text: "Name und Punkte stehen groß vorne auf der Plattform" },
      { emoji: "🟢", text: "Der Schleim reicht jetzt wirklich bis ganz unten" },
      { emoji: "🔧", text: "Stehende Figuren werden jetzt zuverlässig gebastelt" },
    ],
  },
  {
    version: "0.23.0",
    date: "2026-09-26",
    title: "Neues Spiel: Pixelpanik!",
    items: [
      { emoji: "👾", text: "Ein Bild aus dicken Klötzchen wird Stufe für Stufe schärfer" },
      { emoji: "⚡", text: "Wer es früh erkennt, kassiert bis zu 200 Punkte" },
      { emoji: "⌨️", text: "Antwort eintippen – kleine Tippfehler verzeiht der Moderator" },
      { emoji: "🚪", text: "Falsch getippt? Raus für dieses Bild – und der Moderator lästert" },
      { emoji: "🧸", text: "Für Kids mit vier Antworten zum Antippen – keiner fliegt raus" },
      { emoji: "🍹", text: "Im Party-Modus mit extra frechen Motiven und Sprüchen" },
    ],
  },
  {
    version: "0.22.0",
    date: "2026-09-26",
    title: "Das Survival-Finale hat jetzt einen großen Auftritt – und ein Treppchen!",
    items: [
      { emoji: "⏩", text: "Nach der letzten Runde geht's direkt ins Finale" },
      { emoji: "🛗", text: "Startschuss: Alle Aufzüge fahren gleichzeitig hoch – der Beste am längsten" },
      { emoji: "🫧", text: "Wer baden geht, bleibt auch wirklich im Schleim" },
      { emoji: "🎙️", text: "Der Moderator schickt alle zum Abtrocknen – und flott zur Siegerehrung" },
      { emoji: "🏆", text: "Siegertreppchen: Der Sieger stemmt seinen eigenen Pokal" },
      { emoji: "🔉", text: "Das Schleim-Blubbern ist etwas leiser" },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-09-26",
    title: "Eure Figuren stehen jetzt in voller Größe auf der Bühne!",
    items: [
      { emoji: "🧍", text: "Foto-Avatare gibt’s jetzt auch als stehende Ganzkörperfigur" },
      { emoji: "😱", text: "Im Survival-Finale zittern, jubeln und erschrecken eure Figuren mit" },
      { emoji: "🫧", text: "Wer in Gefahr ist, sieht auch so aus – bis zur Panik" },
      { emoji: "⭐", text: "Deine Figur bleibt fürs nächste Mal gespeichert – ganz automatisch" },
    ],
  },
  {
    version: "0.20.2",
    date: "2026-09-26",
    title: "Jetzt hört ihr den Schleim.",
    items: [
      { emoji: "🔊", text: "Survival-Finale: Platsch, Buzzer und Ticken sind endlich laut und deutlich" },
      { emoji: "🫧", text: "Der Schleim blubbert das ganze Finale über hörbar vor sich hin" },
      { emoji: "🎵", text: "Hintergrundmusik etwas leiser – und sie macht Platz für jeden Effekt" },
    ],
  },
  {
    version: "0.20.1",
    date: "2026-09-26",
    title: "Die Lobby hat sich hübsch gemacht.",
    items: [
      { emoji: "✨", text: "Aufgeräumte Lobby: Einstellungen ordentlich in einer Reihe" },
      { emoji: "🎬", text: "„Spiel starten“ steht jetzt frei und groß in der Mitte" },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-09-26",
    title: "Das Survival-Finale klingt jetzt so, wie es aussieht: Es blubbert, ruckelt, platscht.",
    items: [
      { emoji: "🫧", text: "Der Schleim blubbert – und wird bedrohlicher, je knapper es wird" },
      { emoji: "🚨", text: "Warnlampe heult, wenn jemand kurz vorm Baden ist" },
      { emoji: "⏱️", text: "Jede verlorene Sekunde tickt hörbar" },
      { emoji: "💥", text: "Falsche Antwort: Buzzer und der Aufzug sackt ab" },
      { emoji: "💦", text: "PLATSCH genau im Moment des Aufpralls" },
      { emoji: "🏆", text: "Eigene Sounds für Intro, die letzten zwei und den Sieger" },
    ],
  },
  {
    version: "0.19.1",
    date: "2026-09-26",
    title: "Aufgeräumt: Die Spielauswahl in der Lobby sitzt jetzt wieder gerade.",
    items: [
      { emoji: "🔧", text: "Spielauswahl in der Lobby: nichts mehr abgeschnitten oder verrutscht" },
      { emoji: "🟢", text: "Die Lobby zeigt das Survival-Finale extra an statt als Kategorie" },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-09-25",
    title: "Das große Finale: Eure Punkte werden zu Lebensenergie – und unter euch blubbert der Schleim.",
    items: [
      { emoji: "🟢", text: "Neu: Survival-Finale – der Letzte, der trocken bleibt, gewinnt" },
      { emoji: "🛗", text: "Jeder steht auf einem Aufzug – falsche Antworten fahren abwärts" },
      { emoji: "⏱️", text: "Schnell richtig gibt +50, Zögern kostet jede Sekunde Punkte" },
      { emoji: "💀", text: "Es wird immer schneller – bis zum gnadenlosen Death Mode" },
      { emoji: "🎙️", text: "Der Moderator kommentiert jeden Absturz – mit Running Gags und PLATSCH!" },
      { emoji: "⚙️", text: "Das Finale lässt sich in den Einstellungen ein- und ausschalten" },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-09-25",
    title: "Der Moderator hat sich warmgeredet: Jetzt lästert er nach jeder Frage – trocken, frech und mit deinem Namen.",
    items: [
      { emoji: "🎙️", text: "Nach jeder Frage ein Spruch – der Moderator hält nicht mehr die Klappe" },
      { emoji: "😏", text: "Über 100 neue trockene Sprüche: „Wolltest du überhaupt hierher?“" },
      { emoji: "📛", text: "Er spricht dich mit deinem Namen an – auch bei den schnellen Sprüchen" },
      { emoji: "🧸", text: "Kinder bekommen nur liebe Sprüche, Party-Runden die frechen" },
      { emoji: "🍸", text: "Party-Modus: Jetzt auch mit Sprüchen über den Pegel" },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-09-25",
    title: "Party-Modus aufgedreht: fast 300 neue Fragen rund um Alkohol, Liebe und Sex – ab 18 und garantiert in jeder Runde.",
    items: [
      { emoji: "🍸", text: "Fast 300 neue Party-Fragen: Cocktails, Kater, Flirten und Dating" },
      { emoji: "🎯", text: "In jeder Party-Runde kommen garantiert Party-Fragen – gut verteilt" },
      { emoji: "🎚️", text: "Neuer Regler „Party-Anteil“: 30 %, 50 % oder volle Kanne 100 %" },
      { emoji: "🚗", text: "Führerscheinprüfung: Promille-Fragen für den Heimweg von der Party" },
      { emoji: "😏", text: "Bei Party-Fragen wird der Moderator ein bisschen frecher" },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-09-25",
    title: "Allein zu Hause? Jetzt lässt sich jedes Spiel auch solo spielen – der Moderator schummelt ein paar Lügen dazu.",
    items: [
      { emoji: "🙋", text: "Jedes Spiel klappt jetzt schon mit einer Person" },
      { emoji: "🗓️", text: "Spiele auswählen, bevor überhaupt jemand da ist" },
      { emoji: "🤖", text: "Bluff-Spiele: Der Moderator erfindet eigene Lügen dazu – fall nicht drauf rein" },
      { emoji: "🦹", text: "Punkteklau allein: Niemand zum Beklauen? Dann gibt's einfach Punkte" },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-09-25",
    title: "Spiel vorzeitig beendet? Jetzt gibt's trotzdem eine Siegerehrung – und danach geht's direkt zurück in die Lobby.",
    items: [
      { emoji: "🏁", text: "Spiel vorzeitig beendet? Kurze Siegerehrung mit dem aktuellen Stand" },
      { emoji: "🥇", text: "Siegertreppchen für die besten Drei – auch mittendrin" },
      { emoji: "🛋️", text: "Nach dem Finale geht's zurück in die Lobby – alle bleiben dabei" },
      { emoji: "📱", text: "Aufs Handy: dein Platz und deine Punkte zum Schluss" },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-09-25",
    title: "Rausgeflogen? Kein Problem mehr – einfach den QR-Code scannen und deinen Namen antippen, schon bist du wieder im Spiel.",
    items: [
      { emoji: "👋", text: "Handy weg? QR-Code scannen, Namen antippen – mit allen Punkten zurück" },
      { emoji: "📶", text: "Kurze Funklöcher merkt keiner mehr – das Handy verbindet sich von selbst" },
      { emoji: "🚪", text: "Zu spät gekommen? Einfach mitten im Spiel einsteigen" },
      { emoji: "📵", text: "Der Fernseher zeigt, wessen Handy gerade weg ist" },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-09-25",
    title: "Neues Spiel: Skurrile Ereignisse – wahre Geschichten, die keiner glaubt. Erfindet die beste Lüge!",
    items: [
      { emoji: "🤯", text: "139 wahre, verrückte Geschichten – nur das Ende fehlt" },
      { emoji: "🤥", text: "Erfindet ein glaubwürdiges Ende und legt die anderen rein" },
      { emoji: "🧸", text: "Auch für Kids: 30 Geschichten extra für Kinder" },
      { emoji: "📚", text: "Bei der Auflösung: die Wahrheit, der Hintergrund und die Quelle" },
    ],
  },
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
