# Couch Clash – Führerscheinprüfung question format

Every question (JSON object):
{
  "text": "Frage (≤ 120 Zeichen, Deutsch)",
  "options": ["", "", "", ""],          // exactly 4, ≤ 40 chars each, distinct
  "correctIndex": 0-3,                  // spread evenly
  "difficulty": 1|2|3,
  "ageRating": 6|12,                    // 6 only if a kid (6–10) can answer (e.g. Stoppschild, Ampelfarben, Zebrastreifen)
  "tags": ["lowercase", "german"],      // e.g. "schilder","vorfahrt","tempo","parken","autobahn","alkohol","bußgeld","fahrrad"
  "explanation": "1 kurzer Satz, warum – wird bei der Auflösung gezeigt (≤ 140 Zeichen)",
  "media": null | SIGN | SCENE
}

SIGN media (the TV shows the real German traffic sign as an image):
{ "kind": "sign", "signs": ["206"] }            // official StVO sign numbers (VzKat), e.g. "205", "206", "274-53" (Tempo 30), "1020-30" (Zusatzzeichen)
Several signs = shown stacked top→bottom (main sign first, Zusatzzeichen below).
The question text must NOT give the answer away (e.g. "Was bedeutet dieses Verkehrszeichen?").

SCENE media (rendered by us as a top-down SVG crossroads, 70s style):
{
  "kind": "scene",
  "arms": ["N","E","S","W"],                    // 4 = Kreuzung, 3 = Einmündung (T-junction)
  "signs": { "S": ["306"], "N": ["306"], "E": ["205"], "W": ["205"] },   // signs standing at each arm facing the approaching traffic; {} = no signs (rechts vor links)
  "priorityPath": null | ["S","E"],              // arms connected by the priority road (for abknickende Vorfahrt, drawn thicker); null if no priority road
  "vehicles": [
    { "id": "rot",  "type": "car"|"truck"|"bike"|"tram"|"bus"|"police", "color": "rot"|"blau"|"grün"|"gelb", "from": "S", "turn": "straight"|"left"|"right", "siren": false }
  ],
  "pedestrians": [ { "at": "E", "crossing": true } ]   // optional
}
Directions: "from" = the arm the vehicle comes FROM, driving into the junction. The viewer looks from above, N = top.
Vehicles are named by colour in texts/options: "das rote Auto", "der blaue Lkw", "das grüne Fahrrad", "die gelbe Straßenbahn".
Scene questions: "Wer darf zuerst fahren?", "Wer muss warten?", "In welcher Reihenfolge fahren die Fahrzeuge?" (options like "Blau, Rot, Grün").
Only standard, unambiguous textbook situations (StVO §8, §9, §2, §38, §41, §42). No deadlock situations (e.g. four vehicles at a plain rechts-vor-links crossroads). No traffic lights/police officers in scenes.
