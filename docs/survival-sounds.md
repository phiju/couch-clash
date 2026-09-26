# Survival Finale – Sounds

Alle Dateien sind zugeschnitten (keine Stille am Anfang/Ende), mit kurzem Fade-out
und auf eine gemeinsame Lautheit abgestimmt. Keine Datei übersteuert.

| Datei | Ereignis | Abspielen |
|---|---|---|
| survival-intro.mp3 | Start des Finales / Regel-Intro | einmal |
| survival-bonus.mp3 | richtige Antwort mit +50 | einmal |
| survival-wrong.mp3 | falsche Antwort / Timeout (−200) | einmal |
| survival-elevator-jolt.mp3 | Aufzug sackt ab (−200); leiser (50 %) als Klack, wenn ein Aufzug nach der Startfahrt anhält | einmal, zusammen mit wrong / pro Halt |
| survival-elevator-rise.mp3 | Startsequenz: alle Aufzüge fahren zu ihren Finale-Punkten hoch (~3 s) | einmal, mit Beginn der Fahrt |
| survival-decay-tick.mp3 | jedes −10 beim Live-Verfall | einmal pro Tick |
| survival-splash.mp3 | Eliminierung, synchron zum Aufprall im Schleim | einmal |
| survival-final-two.mp3 | nur noch zwei Spieler | einmal |
| survival-winner.mp3 | Sieger steht fest | einmal |
| survival-slime-bubble-loop.wav | Grundgeräusch des Schleims | Loop, dauerhaft |
| survival-slime-threat-loop.wav | bedrohliches Blubbern, ab CRITICAL | Loop, Lautstärke nach Gefahr |
| survival-warning-lamp-loop.wav | Warnlampe bei ELIMINATION_IMMINENT | Loop, solange Zustand aktiv |

Loops liegen als WAV vor: MP3 fügt technisch bedingt winzige Stille am Anfang ein,
die beim Wiederholen als Klicken oder Lücke hörbar wäre. Die WAV-Loops sind nahtlos
geschnitten und sollten über die Web Audio API mit loop = true abgespielt werden.

Lautstärken sind bereits relativ zueinander abgestimmt (Grund-Blubbern bewusst leise,
Splash/Sieg am lautesten). Alle Pegel stehen zentral in `SOUND_LEVELS`
(`apps/web/src/lib/audio/scenes.ts`, 1 = Datei wie geliefert), einzelne leisere Einsätze
in `SOUND_CUE_VOLUMES` (Klack beim Halt nach der Startfahrt: 0,5). Das Grund-Blubbern
läuft mit 0,75 (vorher 1,5 – um 6 dB leiser); solange ein
Einzeleffekt spielt, treten Musik und Loops zurück (0,4). Während der Moderator spricht,
werden die Spielsounds nur leicht abgesenkt (0,7). Jeden Sound einzeln testen: `/dev/sounds`
(in `next dev` direkt, sonst einmal mit `?dev=1` öffnen).

Fehlt eine Datei oder lädt sie nicht, läuft das Spiel ohne Ton weiter.

Ordner "alternativen": weitere Versionen für Aufzug-Ruckeln und falsche Antwort,
falls die gewählte Version im Spiel nicht passt. Einfach umbenennen und austauschen.
