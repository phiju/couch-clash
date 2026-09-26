# Survival Finale – Sounds

Alle Dateien sind zugeschnitten (keine Stille am Anfang/Ende), mit kurzem Fade-out
und auf eine gemeinsame Lautheit abgestimmt. Keine Datei übersteuert.

| Datei | Ereignis | Abspielen |
|---|---|---|
| survival-intro.mp3 | Start des Finales / Regel-Intro | einmal |
| survival-bonus.mp3 | richtige Antwort mit +50 | einmal |
| survival-wrong.mp3 | falsche Antwort / Timeout (−200) | einmal |
| survival-elevator-jolt.mp3 | Aufzug sackt ab (−200) | einmal, zusammen mit wrong |
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
Splash/Sieg am lautesten). Im Code alle mit gleicher Grundlautstärke abspielen und
nur über eine gemeinsame Master-Lautstärke regeln. Während der Moderator spricht,
Effekte absenken.

Fehlt eine Datei oder lädt sie nicht, läuft das Spiel ohne Ton weiter.

Ordner "alternativen": weitere Versionen für Aufzug-Ruckeln und falsche Antwort,
falls die gewählte Version im Spiel nicht passt. Einfach umbenennen und austauschen.
