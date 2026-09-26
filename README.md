# Couch Clash 🛋️⚡

Couch Clash is a browser party game for the living room. One shared TV screen acts as the **host**, and everyone plays on their **phone**.
Later it will get category modules (quiz, estimation, drawing, bluffing, betting, music, AI content). **Milestone 0.1** contains only the lobby.

## Architecture

```
couch-clash/
├── apps/
│   ├── web/                     Next.js (App Router) + Tailwind → Vercel
│   │   └── src/
│   │       ├── app/                  Pages: landing, host/[code], join, join/[code]
│   │       ├── components/host/      TV screens per phase (lobby, setup, intro, play, scoreboard, finale)
│   │       ├── components/player/    Phone screens per phase
│   │       ├── games/                UI half of each category (HostView + PlayerView) + registry.ts
│   │       └── lib/                  use-room (WebSocket), server clock, API, localStorage, numbers
│   └── party/                   Cloudflare Worker + Durable Objects (PartyServer) → Cloudflare
│       ├── src/index.ts             HTTP API (create/check room) + WebSocket routing
│       ├── src/room.ts              Durable Object "Room": storage, connections, alarms, per-viewer state
│       ├── src/room-logic.ts        Pure lobby logic (join, reconnect, kick)
│       ├── src/game-flow.ts         Pure game flow (setup → intro → play → scoreboard → finale)
│       ├── src/avatar/              Photo avatars: provider interface + OpenAI, R2 store, routes, state logic
│       ├── src/voice/               Host mascot's voice: text + speech providers, prompts, rules, director
│       ├── src/stats/               Question statistics (D1): recorder, votes, content filter
│       ├── src/generate/            AI replacement questions (per-category generators, verify, daily limit)
│       ├── src/admin/               Admin API for /admin/fragen and /admin/kosten (ADMIN_TOKEN)
│       ├── src/costs/               Cost metering (every paid API call → D1) and fixed costs
│       ├── migrations/              D1 migrations (couch-clash-stats)
│       └── test/
└── packages/
    ├── shared/                  Types + zod schemas: messages, room state, GameModule interface, duration
    ├── games/                   Logic half of each category + module registry
    │   └── src/
    │       ├── meta.ts               Client-safe: category metadata + public state types
    │       ├── index.ts              Server-only: module registry (logic + content)
    │       ├── scoring/              Base score strategies, speed modifier, final score (pure, tested)
    │       ├── question-round/       Generic engine for question → reveal categories
    │       ├── quiz/                 "Wissensfragen"
    │       └── estimate/             "Schätzfragen"
    └── content/                 Question files (JSON) + zod schema
        └── data/                     quiz.de.json, estimate.de.json
```

**How it works**

1. The host clicks "Neues Spiel". The web app calls `POST /api/rooms` on the worker. The worker generates a 4-character code and retries if the code is already taken. It initializes the Durable Object for that code and returns the code plus a secret **host token**, which the web app stores in `localStorage`.
2. All clients connect via WebSocket to `/parties/room/<CODE>`. On every (re)connect the client sends `hello_host` (with the token) or `hello_player` (with its player id and secret).
3. **The room is authoritative.** Clients only send intents (`join`, `start_game`, `action`, `skip`, …). The room validates every message with zod, applies the rules and sends each client the state *that client* may see. Correct answers and other players' answers are only included after the reveal.
4. **Settings live in the room.** The host picks categories, question counts and scoring in the lobby while players join (`update_settings`, host only, zod-validated, defaults from the host's `localStorage`). Players only see a short summary. "Spiel starten" goes straight to the first category. After the finale ("Zurück zur Lobby", or automatically after 60 s) everyone lands back in the same lobby with the same settings; "Spiel beenden" mid-game first shows a short award ceremony with the current scores (`end_game`).
5. **After every question:** first the correct answer (~3 s), then an animated leaderboard (~7 s). The server sends a snapshot per player (`scoreBefore`, `pointsGained`, `scoreAfter`, `rankBefore`, `rankAfter`, positions). All screens animate from it: gains appear, scores count up, and rows slide to their new places (FLIP via `motion`, just a fade with `prefers-reduced-motion`). The scoreboard after each category and the final ranking use the same component.
6. **Timers are timestamps.** Every phase has a `phaseEndsAt`. The Durable Object sets an alarm for that time and moves the game on. There is no `setTimeout`, so this survives hibernation. The host's "Weiter" button triggers the same step early.
7. Category modules are pure functions (`init`, `handleAction`, `onTimer`, `onPlayersChanged`, `toPublicState`). The room contains no category-specific code.

## Adding a new category

1. **Logic:** create `packages/games/src/<id>/` with
   - `meta.ts`: `CategoryMeta` (name, description, age rating, tags, timer, questions per round, scoring defaults, which scoring fields the host may edit, estimated seconds per question)
   - `types.ts`: public state types for the UI
   - `module.ts`: the `GameModule`. For question/answer games, `createQuestionRoundModule` from `question-round/engine.ts` does most of the work.
2. **Register** the category in `packages/games/src/meta.ts` (`CATEGORY_METAS`) and `packages/games/src/index.ts` (`GAME_MODULES`).
3. **UI:** create `apps/web/src/games/<id>/` with `HostView` and `PlayerView`, and add them to `apps/web/src/games/registry.ts`. TypeScript reports an error if a registered category has no views.
4. **Content:** add `packages/content/data/<id>.de.json`, a zod schema in `packages/content/src/schema.ts` and an export in `packages/content/src/index.ts`.
5. **Every game works with ONE player** – never gate a category on the player count; no step may wait for "others". **Optional hooks:** `botAction` (what a test bot does now – the room times it, 1–6 s), `pendingTask`/`resolveTask` for server work such as an AI check (the room runs it generically, `null` on timeout – the module falls back), `readAloud` for texts the host reads out (one voice clip per item, the category highlights the item via the line's `cue`), `revealFacts`/`toStats` for commentary and statistics.

## Game modes (Kids / Familie / Party)

One global setting at the top of the host settings decides who is playing (default Familie, remembered on the device and stored in the room):

| | Kids | Familie | Party |
|---|---|---|---|
| Questions | age ≤ 6, difficulty 1 (`kidsMaxDifficulty`: Schätzfragen + Führerschein 2), no alcohol, nothing adult | age ≤ 12 (16 if allowed), nothing adult | everything |
| Difficulty mix | – | leicht / gemischt / schwer | leicht / gemischt / schwer |
| Host "Frechheit" | nett (or frech) | frech (nett / frech / gnadenlos) | frech (nett / frech / gnadenlos) |

- Party asks once per room: „Party-Modus: Nur für Erwachsene – sind alle über 18?“. The host voice may make suggestive (never explicit) jokes only in Party; the hard limits stay in every mode.
- Categories declare `modes` in their metadata (Bluff-Lexikon: Familie + Party). Content items have `alcohol` and `adult` flags (default false). `eligibleForMode()` in `@couch-clash/shared` is the one filter every category's pool goes through; Familie/Party weight the selection by difficulty.
- The settings panel lists only categories of the current mode, warns when a mode has fewer questions than a round allows and caps the slider.
- **Zufall + Spieldauer** (15–90 min): `planGame()` in `packages/games/src/planner.ts` builds a random plan within ±10 % of the target (overheads in `DURATION_CONFIG`), alternating quick and slow categories, a slow one last, repeating a category (never back to back) when the game is long or the mode has few categories. Manual changes switch to „manuell“.

## Bluff-Lexikon

A very rare, real German noun – mostly Latin/Greek terms from medicine, biology, law, architecture, linguistics, book arts, music, geology and astronomy (`packages/content/data/bluff.de.json`, each with article; at most ~5 % of adults know them): 200 family words plus 60 Party words (`adult: true`, age 18 – body, love, excess, all real and checked by a second model). Bluff is played in Familie and Party only; in Party about a third of the words (every third position) come from the Party set. The screen asks „Ein Borborygmus ist …?“ / „Vibrissen sind …?“. Per word:

1. **Write** (60 s): everyone invents a believable definition on the phone (max 80 characters).
2. **Check** (invisible, max 6 s, strong model): the judge compares every definition with the real one and returns verdict, confidence and a short reason (logs only):
   - captures the core meaning (even vaguer or colloquial: „Wenn's weh tut“ ≈ „kleine Wehwehchen“) → „Gewusst!“ (+100), merged into the real answer, never shown; a „correct“ below confidence 0.6 counts as a bluff,
   - near-identical bluffs are merged, offensive ones removed,
   - every bluff is **polished** close to the player's wording (things with article, actions as „Wenn jemand …“, no filler/slang/typos); a polished text that is empty, too long or changes the idea (`sameIdea: false`) is replaced by a light local cleanup.
   Only anonymous texts (s1, s2, …) are sent. If the judge fails, a local check (equality / containment with the real definition) runs before the options are shown.
3. **Present:** options A, B, C, … – only polished texts (TV, phone, voice), all in the same style. The host reads them out.
4. **Vote** (30 s), then **reveal** („Ein Borborygmus ist: …“). Host option (default off): show the authors' original texts („Philip schrieb: …“).

Scoring (strategy `bluff`, no speed bonus, all amounts editable in „Punkte-Einstellungen“):

- real definition found: +100 (`find`),
- fool bonus: `fool × pickers / eligibleVoters` (default fool 100) – eligible voters are all players except yourself who could vote; fooling everyone gives the full 100, 5 of 9 gives +56. Every author of a merged option gets the full bonus,
- correct definition written („Gewusst!“): +100 (`know`) plus `fool × realPickers / eligibleVoters`,
- at most 200 per word (`perQuestionCap`); with no eligible voters there is no bonus. The reveal shows „+56 (5 von 9 reingelegt)“ next to the authors and the „Gewusst“ players with their points on the real definition.

Needs at least 2 players. The judge's „offensive“ rule depends on the mode (Party allows suggestive, never explicit or hateful).

## Skurrile Ereignisse

Same mechanics as the Bluff-Lexikon, but with **true, bizarre stories**: the TV shows the start of a story (context, ≈ 3 lines, year as a badge) and a question („Warum wurde er disqualifiziert?“); everyone invents the ending, then finds the truth among the answers. Own game in the library (right after the Bluff-Lexikon), own settings and statistics.

- **One engine, two adapters:** `packages/games/src/bluff/engine.ts` is content-agnostic; each game is a `BluffContentAdapter` (`bluff/module.ts` for the Lexikon, `skurril/module.ts` for the stories): items + mode filter / party mix, prompt text, real answer, reveal lead and extra, what the judge gets, polishing rules (`JudgeStyle` in `bluff/judge.ts`), phone placeholder. The web views (`apps/web/src/games/bluff/`) are shared and only get their texts per game. A golden-master test (`packages/games/test/bluff-golden.test.ts`) pins the Bluff-Lexikon to its behaviour before the refactor.
- **Content:** `packages/content/data/skurril.de.json` – 139 stories with sources (30 Kids `skurril-kids-*` age 6, 80 Familie `skurril-*` age 12, 29 Party `skurril-party-*` age 18 + adult). Schema `SkurrilStorySchema`: context ≤ 230, question ≤ 100, answer ≤ 80 without final full stop, fact ≤ 220, year or null, http(s) source, adult ⇔ 18.
- **Modes:** Kids (only age 6, any difficulty), Familie (≤ 12, no adult), Party (family pool + ~30 % party stories, spread out). 2+ players, 75 s writing, 3–10 stories (default 5).
- **Judge:** an answer is correct when it describes the same core event / reason (vaguer is fine; a different detail, mechanism or number is a bluff). Bluffs are polished into the same grammatical form and tone as the real answer so it doesn't stand out. Same fallbacks as the Lexikon.
- **Voice / reveal:** the host reads context + question when the writing starts (fixed text, no AI line). The solution shows „Die Wahrheit: …“, the fact and „Quelle: domain“ (no link on the TV); the admin page links the source. No AI replacement generator – the stories are verified by hand.

**Per-question cap:** every category has „Höchstens pro Frage“ (default 200) in the Punkte-Einstellungen; the room applies it once more to every score update as a safety net.

## Führerscheinprüfung

Traffic signs, right of way and road rules – 155 questions (`packages/content/data/fuehrerschein.de.json`, format: `docs/fuehrerschein/SCHEMA.md`): 60 text, 55 sign and 40 junction-scene questions, 26 of them for Kids (age 6). It **is the quiz** (`createQuizLikeModule` in `packages/games/src/quiz/module.ts`): same scoring, speed bonus, cap, statistics, 👍/👎 and „Stimmt nicht?“, plus:

- **Pictures:** `media` is `null`, `{ kind: "sign", signs: ["274-53", "1020-30"] }` (real sign SVGs in `apps/web/public/signs`, main sign first, Zusatzzeichen below) or a `scene` drawn by `<TrafficScene>` (`apps/web/src/games/fuehrerschein/`): top-down junction, N at the top, right-hand traffic, 3 or 4 arms, signs upright on posts at the right-hand side of each approach, vehicles (car, truck, bus, bike, tram on rails, police with blue light) with blinking indicators, dotted turn arrows and a colour chip each („Rot“ – never A/B/C/D, those are the answer buttons). Geometry lives in `scene-layout.ts` (pure, tested).
- **Mix and timing:** a round mixes text / sign / scene evenly (5–10 questions, default 8). 15 s per text or sign question, 20 s per scene (`questionSeconds` in the engine, also the speed bonus's time limit).
- **Reveal:** the explanation („Merke: …“) under the right answer (shown, not read out). Scenes: the vehicles drive through in the answer's order (`driveOrder`, read from the correct option: an order „Blau, Rot, Grün“, the first vehicle, or the waiting one last) – 3–5 s, a click skips it, reduced motion shows numbers instead.
- **Driving-school show:** FAHRSCHULE roof sign on the category intro, the host holds a clipboard and plays the know-it-all driving instructor (`hostPersona` in the meta), exam-sheet styling. After the last question every player gets a **Prüfungsergebnis** – a BESTANDEN / DURCHGEFALLEN stamp (from 70 % right, `FUEHRERSCHEIN_CONFIG.passShare`) on TV and phone, and the host comments it. Show only: it never changes points. Generic engine hook: `summary` (step `"summary"`, `GameModule.summaryFacts`).

## Pixelpanik

A picture on the TV starts as 4×4 big pixels and gets sharper in six stages (4×4 → 8×8 → 16×16 → 32×32 → 64×64 → full resolution); whoever recognizes it earlier gets more points. The phones never show the picture – only the input. Logic: `packages/games/src/pixelpanik/` (own module, server-authoritative), views: `apps/web/src/games/pixelpanik/`.

- **Stages and points** (host: „Punkte-Einstellungen“): 200 / 180 / 150 / 100 / 50 / 20 by the stage of the right answer – everyone right in the same stage gets the same. „Sekunden pro Stufe“ (default 4, 2–15), then 5 s solution and the leaderboard. Points are booked at the solution. 3–10 pictures per round (default 5).
- **Familie / Party (free text):** one guess per picture, sendable any time. Check (`pixelpanik/match.ts`): normalize (lower case, ä→ae, ß→ss, accents, spaces, hyphens, leading articles), then Levenshtein against answer + synonyms – 0 typos up to 3 letters, 1 up to 5, 2 up to 9, else 3 („Kolloseum“, „eifelturm“ ✓). A guess closer to another motif than to this one is wrong („Irland“ ≠ „Island“). Wrong = out for this picture (spectator screen), right = locked. The picture ends when everyone is done or after stage 6.
- **Kids (multiple choice):** the four `kids_choices`, shuffled. A wrong option stays greyed out and locks the player until the next stage – nobody is ever out. Only motifs with `kinder`.
- **Motifs:** `packages/content/data/pixelpanik/motive.json` (169, zod schema `PixelpanikMotifSchema`). `modes`: `kinder` → Kids, `erwachsene` → Familie, `party` → Party; motifs only for `party` are the party pool (≥ 30 % of a Party round, `selectWithPartyShare`). The difficulty mix (leicht / gemischt / schwer) weights the pick. Never the same motif twice per room; topics are mixed (never two in a row when avoidable). **Motifs without `image` are never played** – until the image script ran, the game is hidden in the settings.
- **Anti-cheat:** the stages are pre-rendered (image script) under random file names – no motif id, no stage in the name. The server sends the TV only the URL of the *current* stage; the full picture comes with stage 6. Phones never get a picture URL, and in free text they never get the options. The TV draws a stage onto an N×N canvas and scales it up with `imageSmoothingEnabled = false`; the full picture „snaps“ in (flash + bounce, `sting-short`).
- **Host voice:** event-driven like the Survival-Finale (`apps/party/src/voice/pixelpanik-voice.ts`): nobody tried by stage 2 (picks on a random player), wrong guess, right at 4×4 / 8×8, right only at full resolution, nobody got it. **The lines live in `apps/party/src/voice/pixelpanik-lines.ts`** – `{name}` placeholder, pools `family`, `party` (extra, cheekier) and `kids`; the last 3 per situation are locked. Audio: cached lines are free, new ones are made at the round start (max 4,000 credits per round, a few per player and situation first).
- **Avatars:** early hit → the avatar zooms in and cheers (`jubelnd`), out → `enttaeuscht`.

### Pictures (once, before the first game)

`packages/content/scripts/pixelpanik-images.mjs` fetches every picture, crops it square (subject centred), renders the six stages (sharp) and uploads them to **Supabase Storage** (bucket `pixelpanik`, created public if missing); the URLs are written back into `motive.json` (commit the file afterwards). Idempotent: motifs with `image` are skipped; the file is saved after every motif.

- `ai` → OpenAI Image API (`gpt-image-2`, 1024×1024, `--quality medium` ≈ $0.04–0.07 per picture, ~130 pictures)
- `svg` → flags from the npm package `flag-icons` (1x1), rendered to PNG (`flag_code`)
- `wikimedia` → public-domain paintings from Wikimedia Commons (`wikimedia_file`, falls back to a search); title, artist, licence and link go into `image.source` and are shown at the solution

```bash
SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… OPENAI_API_KEY=… \
  pnpm --filter @couch-clash/content images:pixelpanik            # everything missing
  # --source svg | --only pp-001,pp-031 | --limit 10 | --force | --out-dir ./tmp/pp (dry run, local files only)
```

End-to-end check (needs pictures + `pnpm dev:party` + `pnpm dev:web`): `MODE=family|party|kids SHOTS=./shots pnpm --filter @couch-clash/web e2e:pixelpanik`.

## Survival-Finale

The optional last round of a game (host switch „Survival-Finale zum Schluss“, default on; `CategoryMeta.finale` – always played last, once, never planned by Zufall). The main game's points become **life energy**; questions (multiple choice from the quiz pool) keep coming until one player is left.

- **Rules** (`packages/games/src/survival/`, pure + server-authoritative, all numbers in `config.ts`): start = `200 + 1000 × score / best` (rounded to 10; best ≤ 0 or all tied → 1200, score ≤ 0 → 200). Per question one answer: right within the bonus time +50, right until the decay threshold ±0, after it −10 per full second (booked live by server ticks – `phaseEndsAt` every second – idempotently per player), wrong or no answer by the timeout −200. Score ≤ 0 → out at the exact server time. Phases after every 4 questions: 5/10/20 s → 4/8/16 → 3/6/12 → DEATH MODE 2/4/8 s, no bonus, −50 for everyone after each question (the finale always ends). Everyone out in the same question → sudden death (back with 100 in DEATH MODE, 3×, then an estimate question decides – `sudden-death.ts`, swappable). Placing = elimination order; the finale screen shows it (`ModuleUpdate.ranking`), the main-game points stay untouched. Questions: fresh ones → earlier games → AI refill (module task) → last resort; never one of the running game.
- **TV** (`apps/web/src/games/survival/`): candidates on elevators over a slime pool (CSS/SVG). The elevator height is a separate visual position (`visualHeight`, stretched near the slime) – never the score itself. Live descent, danger states (WARNING → CRITICAL → ELIMINATION_IMMINENT), splash + „ELIMINIERT“, final two, winner. Sound/effect hooks: DOM event `couchclash:survival` for every game event plus `DECAY_TICK`.
- **Sounds** (`apps/web/public/audio/survival-*`, mapping in `docs/survival-sounds.md`): ids are the file names; one-shots MP3, the three loops seamless WAV played by the Web Audio API with `loop = true` over the whole file. `apps/web/src/games/survival/sounds.ts` maps the hook events to sounds (FINALE_STARTED → intro, FAST_CORRECT → bonus, WRONG_ANSWER / TIMEOUT → wrong + elevator jolt, DECAY_TICK → tick per −10, ELIMINATED → splash on the impact, FINAL_TWO, WINNER) and the live danger to the loops (AMBIENCE: slime bubbling always, threat loop from CRITICAL by danger, warning lamp at ELIMINATION_IMMINENT). All at the same base level on their own bus, lowered while the host speaks; a missing file never stops the game. Alternatives in `public/audio/alternativen/`.
- **Moderator** (`apps/party/src/voice/survival-*.ts`): event-driven German pools (`survival-lines.ts`), a pure engine with priority, cooldowns, no repeats and running gags per player; only lines whose audio is cached are picked (named ones fall back to nameless). Nameless lines are voiced once for all rooms (admin „Moderator-Sprüche vertonen“ or on the first finale), `{playerName}` lines at the start of each finale (likeliest events first, max 6,000 credits per finale, logged). The host queue plays one line at a time, by priority; WINNER / ELIMINATED / SUDDEN_DEATH fade out a lower line; comments older than 2.5 s are dropped; „PLATSCH!“ waits for the splash. No bubbles – optional caption line (`moderatorCaptions`, off). The game never waits for audio.

End-to-end check: `SHOTS=./shots pnpm --filter @couch-clash/web e2e:survival` (needs `pnpm dev:party` + `pnpm dev:web`).

## Reconnect & rejoin

A phone that drops out always gets back in (timings in `CONNECTION_CONFIG`, `packages/shared/src/connection.ts`):

- **Same phone:** partysocket retries forever (backoff 0.5–5 s). On wake-up (`visibilitychange`, `online`, `pageshow`, `focus`) a closed socket is replaced by a fresh one right away. A heartbeat (raw `"ping"` every 15 s, answered by the runtime's auto-response `"pong"` without waking the room) finds sockets that died silently, e.g. on a WLAN ↔ mobile switch: no pong within 5 s → new socket. `hello_player` brings the phone back into exactly the current step. After 8 s on „Verbinde …“ the phone shows „Neu verbinden“ (retrying goes on).
- **Credentials** live in localStorage **and** a fallback cookie `cc_player_<CODE>` (SameSite=Lax, 24 h) for in-app browsers that drop localStorage.
- **Grace period:** a player whose last connection closed still counts as connected for 20 s (`RoomRecord.graceUntil`, persisted, alarm when it ends) – short blips never end a question early. The server closes player sockets without a ping for 45 s (half-open). „All answered“ = all connected players answered; a player who is back in time can still answer; a bluff author's option stays.
- **Another phone / lost credentials („Ich war schon dabei“):** during the game the join link shows „Das Spiel läuft schon. Wer bist du?“ with every player **without an open connection** (`PublicPlayer.online`). Tapping a name sends `claim_seat`: same id, score, avatar and history, a **new secret** (the old one stops working). A connected player can't be taken over. The TV shows „Philip ist wieder da 👋“; the host can kick as usual.
- **Late join:** host setting „Neue Spieler während des Spiels zulassen“ (default on). New players start with 0 points; during a running question they wait (`joinedDuring`, excluded from the module context) and play from the next one. The TV shows „Neu dabei: Tina“.
- **TV:** room code + mini QR in the corner during play and the scoreboard (tap or „Q“ enlarges it), 📵 on avatars of disconnected players.
- **Restarts:** the whole room (players, secrets, scores, phase, grace periods) is saved in Durable Object storage after every change and restored in `onStart`.

End-to-end check (needs `pnpm dev:party` + `pnpm dev:web`): `pnpm --filter @couch-clash/web e2e:reconnect` – reload, offline (`OFFLINE_SECONDS=30,180,900`), closed tab, other browser, rejected credentials, cookie fallback, seat claiming, late join, network switch, „Neu verbinden“, host reload and a worker restart. Screenshots: `docs/screenshots/reconnect/`.

## Local development

Requirements: Node.js ≥ 20 and pnpm (`corepack enable` activates the version set in `package.json`).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev            # starts both: web → http://localhost:3000, party → http://localhost:1999
```

Or start them separately: `pnpm dev:party` and `pnpm dev:web`.

**Testing with real phones on your Wi-Fi:** in `apps/web/.env.local`, set `NEXT_PUBLIC_PARTY_HOST=<your-computer's-LAN-IP>:1999`, restart `pnpm dev`, then open `http://<LAN-IP>:3000` on the TV or laptop. The QR code then points to that address automatically.

**Checks** (the same ones CI should run):

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Deployment

Deploy Cloudflare first, because Vercel needs the worker URL.

### 1. Party server → Cloudflare (Workers Builds, Git integration)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/), then **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub (first time only) and pick the `couch-clash` repository.
3. Settings:
   - **Project name:** `couch-clash`. This must match `name` in `apps/party/wrangler.jsonc`.
   - **Build command:** leave empty
   - **Deploy command:** `cd apps/party && npx wrangler d1 migrations apply couch-clash-stats --remote && npx wrangler deploy`
   - **Root directory (path):** `/`
4. **Before the first deploy**, set up R2 and the OpenAI secret (see [Photo avatars](#photo-avatars-ai)) and the D1 database (see [Question statistics](#question-statistics--admin)). The worker config binds the R2 bucket `couch-clash-avatars` and the D1 database `couch-clash-stats`, and the deploy fails if they don't exist.
5. Click **Create and deploy**.
6. Afterwards the worker is live at `https://couch-clash.<your-subdomain>.workers.dev`. Opening the URL should show "Couch Clash party server 🎉".
   Note the host part without `https://`. You need it for Vercel.

From now on, every push to `main` deploys the worker automatically. The Durable Object uses the SQLite backend, which also works on the free Workers plan.

### 2. Web app → Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the `couch-clash` repository.
2. Settings:
   - **Root Directory:** `apps/web`. Vercel then detects Next.js and pnpm on its own.
   - **Environment Variables:**
     - `NEXT_PUBLIC_PARTY_HOST` = `couch-clash.<your-subdomain>.workers.dev` (without `https://`)
     - `NEXT_PUBLIC_SITE_URL` = your production address, e.g. `https://couch-clash-web.vercel.app`. The QR code and the join link on the TV always point there, even when the host opens a (password-protected) preview URL.
3. Click **Deploy**.

> `NEXT_PUBLIC_*` variables are baked into the build. If you change the value later, go to **Deployments** → **⋯** → **Redeploy**.

The option "Include source files outside of the Root Directory" must stay on (it is by default), because `apps/web` uses `packages/shared`.

## Environment variables

| Variable                 | Where               | Example                                    |
| ------------------------ | ------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_PARTY_HOST` | `apps/web`, Vercel  | `couch-clash.xyz.workers.dev`              |
| `NEXT_PUBLIC_SITE_URL`   | `apps/web`, Vercel  | `https://couch-clash-web.vercel.app` (QR code / join link; falls back to the current address) |

| `OPENAI_API_KEY`         | `apps/party`, Cloudflare Worker **secret** | Photo avatars + the host's texts (never sent to the browser) |
| `ELEVENLABS_API_KEY`     | `apps/party`, Cloudflare Worker **secret** | The host's voice (never sent to the browser) |
| `ADMIN_TOKEN`            | `apps/party`, Cloudflare Worker **secret** | Password for `/admin/fragen` (long random string) |

No secrets are committed to the repository. For local photo avatars, put `OPENAI_API_KEY=…` into `apps/party/.dev.vars` (git-ignored). Without the key, photo avatars answer "not available" and everyone plays with emojis.

## Look & assets

Retro 1970s TV game show. Design tokens (petrol, petrol-dark, orange, rust, bulb, cream, brown), the Fredoka font and the `btn` / `panel` / `chip` utilities live in `apps/web/src/app/globals.css`.

- Images: `apps/web/public/brand/` (stage backgrounds, logo, host mascot)
- Intro reference prototype (not shipped): `docs/brand/intro-reference.html`
- Start page intro: `components/stage-intro.tsx`. Logo/host positions on the stage are computed in `lib/stage-layout.ts` (tested), so the sofa always stands on the stage floor.
- Mascot: `components/mascot.tsx`, one component with `pose` / `message`. To add a pose, add artwork and a keyframe rule.
- Traffic signs: German traffic signs are official works (amtliche Werke, § 5 UrhG) and public domain; the SVGs come from Wikimedia Commons, see `apps/web/public/signs/SOURCES.md`.

## Scoring

**Final Score = Base Score × Speed Modifier** (rounded). Every player's points depend only on their own answer and their own response time; players are never compared with each other.

- **Base score (answer quality)**, one strategy per mode in `packages/games/src/scoring/base.ts`:
  - `absolute`: correct → `maxPoints`, wrong → 0 (Wissensfragen)
  - `proximity`: `maxPoints × max(0, 1 − |answer − correct| / zeroRange)` (Schätzfragen). `zeroRange` defaults to `|correct answer|`; a question can set its own `zeroRange` in the content, which is required for years and for answers that are 0.
- **Speed modifier (optional)** in `scoring/speed.ts`: measured against the question's time limit, from `fastestMultiplier` (answer at 0 s, default 1.5) down to `slowestMultiplier` (answer at the limit, default 0.5). When disabled it is 1.0.
- A base score of 0 stays 0, so a fast wrong answer never earns points.
- Settings per category (`scoring: { mode, maxPoints, speedModifier }`): the mode is fixed by the category; the host can change max points and the speed modifier. Old or invalid settings fall back to the category defaults (`normalizeScoring`).

## Photo avatars (AI)

Players can take a selfie or pick a photo when joining. The party server turns it into a cartoon in the Couch Clash style (the host artwork `apps/web/public/brand/host.webp` is the style reference). **The emoji avatar is always the fallback**, and the game never waits for the AI.

**Flow**
- **Phone:** name → "📸 Selfie machen" / "🖼️ Foto wählen" / "😀 Emoji nehmen". A one-time consent note appears (remembered in `localStorage`; it also says the figure is kept for next time). The phone crops the photo to a centered square (max 512 px, JPEG 0.8; re-encoding strips EXIF) and shows a preview. **Nothing is uploaded before "Verwandeln!"**. The player joins right away with the emoji and sees the waiting screen, then "Passt!" / "Nochmal" (max 2 re-generations). Errors, the 90 s timeout and safety refusals keep the emoji (or the previous image).
- **Worker:** `POST /api/rooms/:code/avatar` (multipart `playerId`, `playerSecret`, `photo`; ≤ 1 MB; JPEG/PNG/WebP, checked by the file bytes). The room sets the avatar's `photo.status` to `pending` and generates in the background (`ctx.waitUntil`). Every client gets `pending → ready | failed` over the room WebSocket. After "Passt!", 3 expressions are generated in the background (jubelnd / enttäuscht / geschockt). The animated leaderboard shows them when a player moves up, moves down, or loses big. In parallel, 5 **standing full-body figures** are made (`figure-standard`, then `figure-jubelnd` / `-besorgt` / `-panisch` / `-geschockt` from the standard figure; portrait 400×600, transparent, one retry each, cost logged). Prompts live in `apps/party/src/avatar/figure-prompts.json`. Fallbacks: missing pose → standard figure → round avatar. The Survival-Finale shows them on the platforms (`StandingFigure`, `apps/web/src/lib/figure.ts`: pose per danger level, short reactions, CSS-only idle motion). **Cost:** the round avatar is made in `medium` quality (≈ $0.07), the 3 faces and 5 figures in `low` (≈ $0.013 / $0.011 each; they are shown small) – about **$0.19 per player** (`AVATAR_CONFIG`, `FIGURE_CONFIG`). **Rate limit:** on HTTP 429 ("too many requests") the worker waits as long as OpenAI says and tries again, up to 30 s per image (`RATE_LIMIT_CONFIG`). Low OpenAI usage tiers allow only a few input images per minute (tier 1: 5) – for game nights with many players, raise the tier.
- **Limits per room:** 16 players × (1 + 2) base images, 16 × 3 expressions, and one job per player at a time. The API returns clear errors (409 busy, 429 limit, 413 too large, 415 wrong type, 401 auth, 404 room).
- **Host:** lobby switch "📸 Foto-Avatare erlauben" (default on), "↺ Emoji" on each player card, and a sparkle plus `sting-short` when a photo avatar is ready.

**Keeping the figure (automatic)**
- The consent note before "Verwandeln!" says so: the photo is deleted right after the transformation, the figure is kept for the next games (only this phone finds it again, deletable any time, gone after 365 days without playing). Tapping "Okay" is the consent; the note is asked again when its content changes (`photoConsentStore`, key `photo-consent-v2`).
- On "Passt!" the server saves the figure right away; faces and standing figures are added as they are made. One saved figure per phone: a new one replaces (deletes) the previous one.
- The server copies the generated images to `saved/<random id>/` in R2. **Only this phone learns the id** (message `photo_saved` to this connection only, stored in `localStorage`). Other clients just see `saved: true`.
- Next time, "⭐ Meine Figur nehmen" appears right after the name. The server copies the figure into the new room: no API call, no cost, all expressions right away.
- "Figur löschen" (`DELETE /api/avatars/saved/:id`) removes it immediately.
- Every use rewrites the files, so the R2 lifecycle rule on `saved/` (365 days) means "365 days without playing".
- There is deliberately no public list or name search: the figures are made from real faces.

**Code:** `apps/party/src/avatar/`
- `config.ts`: model, quality, prompts (**one place to change the model**)
- `provider.ts`: `AvatarProvider.generateAvatar(photo, style) → image`
- `openai.ts`: OpenAI Images "edit" with [photo, style reference]
- `index.ts`: picks the provider (**swap to e.g. Gemini here**)
- `service.ts`: timeout, 256 px resize (Cloudflare Images), R2
- `photo-logic.ts`: pure state transitions (tested)
- `saved.ts`: copies for saved figures
- `jobs.ts`: glue to the room
- `routes.ts`: HTTP

**Privacy**
- The original photo is **never stored**; it only lives in memory during the request.
- Generated avatars are stored in R2 as `rooms/<code>/<playerId>/<expression>.webp`. They are served only while the room exists, deleted on kick/reset and when the room expires (Durable Object alarm), and additionally removed by an R2 lifecycle rule after 1 day.
- Logs contain only error reasons, never images, prompts or responses.

### Cloudflare setup (once)

1. **R2 bucket:** dashboard → **R2 Object Storage** → **Create bucket** → name `couch-clash-avatars` (location: Automatic). Or: `cd apps/party && npx wrangler r2 bucket create couch-clash-avatars`.
2. **Lifecycle rules:** bucket → **Settings** → **Object lifecycle rules** → **Add rule**:
   - `delete-after-1-day`: prefix `rooms/`, delete objects after **1 day**. Or: `npx wrangler r2 bucket lifecycle add couch-clash-avatars delete-after-1-day rooms/ --expire-days 1`
   - `saved-figures-365-days`: prefix `saved/`, delete objects after **365 days** (every use rewrites the files, so this means "365 days without use"). Or: `npx wrangler r2 bucket lifecycle add couch-clash-avatars saved-figures-365-days saved/ --expire-days 365`
3. **Secret:** Workers & Pages → `couch-clash` → **Settings** → **Variables and Secrets** → type **Secret**, name `OPENAI_API_KEY`. Or: `npx wrangler secret put OPENAI_API_KEY`.
4. The bindings are in `apps/party/wrangler.jsonc`:
   - `AVATARS`: R2 bucket `couch-clash-avatars`
   - `IMAGES`: Cloudflare Images, for the 256 px resize. The free plan includes 5,000 unique transformations/month; if a transformation fails, the full-size WebP is stored instead.

## The host speaks (AI voice)

The mascot welcomes every player by name and comments on the leaderboard – about half of the comments live (written from the facts), half from his own library of dry, snarky lines (`packages/content/data/snark-lines.de.json`) with the player's name clip in front. The host device only plays them through the audio manager. The music is ducked; the voice has its own gain, clearly louder than the music, and the master volume still applies.

- **Text:** OpenAI **`gpt-4.1-mini`**.
- **Voice:** **ElevenLabs**, voice `DQ4rTqXxHr077oQgsA9D`, mp3 44.1 kHz / 128 kbps.
  - `eleven_v3` (expressive, audio tags, 1 credit per character) only for welcome, game start and the winner announcement.
  - `eleven_flash_v2_5` (fast, ½ credit per character) for comments, read-outs, the round summary, the test line, library lines and name clips.
  - Voice settings: stability 0.35 (v3: preset 0.5 "natural"), similarity 0.8, style 0.6, speaker boost.
- The OpenAI voice stays in the code: `VOICE_PROVIDER = "openai"` in `apps/party/src/voice/config.ts`.

**No speech bubbles:** the host never shows bubbles or subtitles. He only sways (idle) and bounces slightly while the voice plays. A line that can't be heard is skipped.

**When he speaks**
- **Welcome:** one short line per joining player. At most 3 welcome lines wait on the TV; further names are merged into one line.
- **Game start:** with the number of players.
- **Commentary:** the moment the answers lock (the reveal), the director prepares two things in parallel:
  - a **live line** (~50 %, `liveCommentShare`) from structured facts (answers, right/wrong, estimate vs. correct value, rank changes, fastest answer, streaks), and
  - a **cached library line**: the situation (`wrong`, `wrongStreak`, `lastPlace`, `allWrong`, `allRight`, `surpriseRight`, `leader`, `fooledMany`, `fooledNone`, `wildEstimate`, `bullseye`) picks the category and the target; the line is random, never twice in a game, never the same target twice in a row (if only the last target fits, the line is said without a name). Kids only use kids lines, Party family + party lines.
  - When the leaderboard starts, the live line plays if it is ready, otherwise the cached one – never silence. A line still playing may keep the leaderboard up to 3 s longer.
  - **Name clips:** when a player joins, one short clip with just the name ("Max …") is made once (reused globally for the same name). Library lines play as name clip + 150 ms + line.
  - "Kommentare": `oft` (default) = after every question; `normal` = after every noteworthy question (streaks, all wrong/right, new leader, new last place, bluffs, wild estimates/bullseyes, surprise right) and at least every 2nd; `selten` = every 3rd question. The last question of a category is always commented.
- **Finale:** winner announcement.

**Host settings** (lobby / setup)
- 🎙️ Moderator spricht
- Kommentare
- Frechheit (`nett` / `frech` / `gnadenlos`): hard limits, rotating targets, automatic `nett` for categories with an age rating below 12 unless overridden
- **Sprechtempo:** `normal` = speed 1.0, `schnell` = 1.15 (default), `turbo` = 1.2 plus playback at 1.1 with preserved pitch on the host
- **Moderator testen:** "▶ Probe-Spruch" / "▶ Nochmal"

**Audio tags**
- For `eleven_v3` lines the text model may add 1–2 tags from `[excited] [laughs] [gasps] [sarcastic] [whispers] [shouting]`. Any other tag is removed.
- For `eleven_flash_v2_5` all tags are removed before sending.

**Limits / errors**
- Per room: **12,000 ElevenLabs credits** for NEW audio (`creditBudgetPerRoom`, Starter plan = 30,000 per month), counted per model (flash ½, v3 1 per character sent). **Cached audio is free** and never counted: library lines, name clips heard before, read-outs heard before.
- Per room: max 150 generated texts; after that, library lines only.
- **Monthly guard:** the real account usage (`GET /v1/user/subscription`, cached 10 min) is shown in the host's voice panel and on `/admin/fragen` ("ElevenLabs: 18.400 / 30.000 Credits diesen Monat"). With less than 10 % left: no new live lines or read-outs, only cached audio. The API key needs the "User → Read" permission for this; without it the usage is simply unknown and nothing is blocked.
- Budget used up, quota exceeded / 401 / 402 / 429 / voice not available → **no new audio** for this room; cached library lines keep playing and the game continues. Only the error code is logged.
- Timeouts: text 4 s, speech 8 s. A live comment that isn't ready in time is replaced by a cached one.

**Voice cache (R2):** text that is the same in every room is generated once and stored globally under `voice-cache/<voiceId>/<snark|names|read>/<sha256>.mp3` (hash of model, speed and text), served at `/api/voice-cache/…` with an immutable cache header. The lifecycle rule on `rooms/` doesn't touch it. **Once after deploying:** `/admin/fragen` → **„Moderator-Sprüche vertonen“** voices the 105 library lines (~2,400 credits, batch by batch; never at game start). Lines still missing are voiced on first use.

**Safety**
- Player names are sanitized, only placed in a quoted JSON data block, and the model ignores instructions inside it.
- Logs contain counts and error codes only, never names or texts.

**Attribution:** the ElevenLabs free tier requires attribution. The start page shows a small "Stimme: ElevenLabs" (`SHOW_VOICE_ATTRIBUTION` in `apps/web/src/lib/config.ts`, default on).

**Code** (`apps/party/src/voice/`)
- `config.ts`: provider, models, voice, budgets
- `provider.ts`: `TextProvider`, `SpeechProvider`
- `elevenlabs.ts` / `openai.ts`
- `tags.ts`
- `prompt.ts`, `rules.ts`, `service.ts`, `director.ts`
- `snark.ts` (situations, targets, library lines), `cache.ts` (global voice cache), `admin.ts` (library task)

**Storage:** live lines live in R2 under `rooms/<code>/voice/<id>.mp3`, are deleted with the room, and are covered by the 1-day rule on `rooms/`. Cached audio lives under `voice-cache/` (see above).

## Question statistics & admin

Every played question is counted in **Cloudflare D1** (database `couch-clash-stats`, binding `STATS`). Aggregated numbers only – never player names or answers.

- **At the reveal** the room writes one upsert per question (`question_stats`): plays, answers, correct answers (estimates: very close), sum of response times, sum of error shares (estimates). Runs in the background (`waitUntil`) and never blocks the game.
- **👍 / 👎** on the phones during the reveal and the leaderboard: one vote per player, tapping the other thumb changes it. Written as counts when the question is over. Nothing is shown on the TV. Thumbs never change a question's status.
- **"⚠️ Stimmt nicht?"** in the host's "⋯" menu during the reveal: the question is quarantined right away (+1 report), toast "Zur Prüfung markiert" with 10 s "Rückgängig".
- **Status** `active` / `quarantined` / `removed`. When a round starts, the room loads the non-active ids and the generated questions (cached ~5 min). If D1 is unreachable, the game plays without the filter.
- Categories provide the numbers via the module hook `toStats`, and their catalog via `listContent` / `parseContent`. The room has no category-specific code.

### Admin page `/admin/fragen`

Asks for the `ADMIN_TOKEN` (kept in `sessionStorage` of that tab only); the worker checks it on every `/api/admin/*` request (`401` if wrong, `503` if not set). Table of all questions joined with the content: text, correct answer, difficulty, plays, correct rate / average error, average time, 👍/👎, reports, status, last played. Sortable, filter by category, search, quick filters (Quarantäne, rausgeworfen, neu generiert, gemeldet, viele 👎, Schwierigkeit passt nicht, nie gespielt), actions per row and in bulk, CSV export of the current view.

**Rauswerfen** (with confirmation) removes a question for good and writes a replacement automatically: a generator per category (`apps/party/src/generate/generators.ts`) asks OpenAI for a question in the same category with the same age rating, difficulty and tags (similar questions are passed on to avoid duplicates), a second call checks it (yes/no + reason; estimates must be stable facts), up to 3 attempts. The result is validated with the category's zod schema, stored in `generated_questions` and played from the next round on (flag "neu generiert", editable in the admin). Max 50 replacements per day (`GENERATION_CONFIG`); errors are listed in the admin page.

### Setup (once)

1. **D1 database:** Cloudflare dashboard → **Storage & databases** → **D1** → **Create** → name `couch-clash-stats`. Or `cd apps/party && npx wrangler d1 create couch-clash-stats`. Put the Database ID into `apps/party/wrangler.jsonc` (`d1_databases`).
2. **Tables:** migrations live in `apps/party/migrations/`. The deploy command applies them (`npx wrangler d1 migrations apply couch-clash-stats --remote`); nothing to do by hand.
3. **Secret:** Workers & Pages → `couch-clash` → **Settings** → **Variables and Secrets** → add **Secret** `ADMIN_TOKEN` (long random string, e.g. `openssl rand -hex 24`).
4. **Deploy command** (Settings → Builds): `cd apps/party && npx wrangler d1 migrations apply couch-clash-stats --remote && npx wrangler deploy`.

Locally: `cd apps/party && npx wrangler d1 migrations apply couch-clash-stats --local`, and `ADMIN_TOKEN=…` in `apps/party/.dev.vars`.

## Costs `/admin/kosten`

Same `ADMIN_TOKEN` as `/admin/fragen`. Shows per month: total, measured API costs, fixed costs, and the average cost of one photo avatar; a bar chart of the last 30 days; the measured costs per purpose (round avatar, faces, standing figures, moderator texts and voice, replacement questions, AI checks in the game); ElevenLabs credits.

- **Measured automatically** (`apps/party/src/costs/`): every provider gets a measured `fetch` (`meteredFetch`). After a successful call it reads the token counts from OpenAI's answer (or counts characters for text-to-speech) and adds one row per UTC day × kind to the D1 table `api_usage` (migration `0002_costs.sql`, in the background – the game never waits, a failed write only logs). Prices per model live in `costs/prices.ts` – update them there. Failed calls aren't billed and aren't counted. Only numbers are stored, never prompts, texts or player data. ElevenLabs is paid by the plan, so only its credits are counted.
- **Fixed costs** (Claude, ElevenLabs plan, domain, …) are entered on the page: name, amount per month (€ or $), from month, optional until month („Beenden“ ends it this month). Stored in `fixed_costs`.
- Everything is shown in euros; dollars are converted with the fixed rate `COST_CONFIG.usdToEur` (`packages/shared/src/costs.ts`). Estimates – the real bill is in the OpenAI dashboard. Measuring starts with the deploy of this page.

## Neuigkeiten (release notes)

- Data: `apps/web/src/content/changelog.ts` (typed, newest first) – German, for players, fun and non-technical. Every PR that changes something visible adds or updates an entry (rule in `CLAUDE.md` and `apps/web/AGENTS.md`): new feature → minor, fixes only → patch.
- Start page only (TV / host device): after the intro a popup „🎉 Juhu, neue Version!“ lists what's new since the last visit (max 3 versions, then „… und mehr“). The first visit shows nothing and just remembers the version (`localStorage`). ESC, a click outside or „Los geht's“ close it. Phones that join via QR code never see it.
- Footer „v0.9 · Neuigkeiten“ and the page `/neuigkeiten` (timeline of all versions).

## Sound (host only)

The TV/laptop plays music and effects; phones never do.

- Files: `apps/web/public/audio/` (`jingle`, `lobby`, `think`, `sting`, `sting-short`, `fanfare` + `audio.json` with loop points). They are already loudness-normalized, so they must not be re-encoded.
- Engine: `lib/audio/engine.ts` (Web Audio API). The files are preloaded after "Los geht's!". Loops use the exact `loopStart`/`loopEnd` points, only one loop plays at a time with a 0.8 s crossfade, one-shots duck the music to 30 %, and the tab's audio pauses while it is hidden.
- **When what plays:** `lib/audio/scenes.ts` (`audioSceneFor`, tested). A category can take over through the `audio` field of its `GameViews`, e.g. `{ music: null }` for music rounds.
- Welcome screen: the first click ("Los geht's!") unlocks audio for the session. A host page opened directly shows "🔊 Ton aktivieren" instead. The volume menu sits top right and the level is remembered.

## Status

**Milestone 0.1 – Lobby** ✅ Rooms, join by code/QR, avatars, reconnect, remove players, 24h expiry.

**Milestone 0.2 – Categories** ✅
- [x] Category/module system with a registry (logic in `packages/games`, UI in `apps/web/src/games`)
- [x] Game setup: pick categories or "Zufall", questions per category, scoring settings (remembered on the device), duration estimate
- [x] Game flow: intro → questions with timer (ends early when everyone answered) → reveal → scoreboard → finale → back to the lobby ("Spiel beenden" → short award ceremony)
- [x] "Wissensfragen" (multiple choice) and "Schätzfragen" (numbers) with configurable scoring
- [x] 43 quiz and 31 estimate questions (German), no repeats within a room
- [x] Per-viewer state: no answers leak before the reveal
- [x] Game settings directly in the lobby, summary on the players' phones
- [x] Animated leaderboard after every question (TV + phones), reused for scoreboard and final ranking

**Milestone 0.4 – Welcome screen, sound & laptop layout** ✅ Welcome card with "Los geht's!", host audio engine (jingle, loops, stings, fanfare), all host screens fit 1280×720 … 4K without scrolling.

**The host speaks (AI voice)** ✅ Welcome by name, game start, leaderboard commentary with "Frechheit" levels, winner announcement – voice by ElevenLabs, host device only, no speech bubbles, credit budget per room, snark library with name clips (never silent).

**Photo avatars (AI)** ✅ Selfie/photo → cartoon in the show style via OpenAI, 3 expressions for the leaderboard, emoji fallback, R2 storage with cleanup, "⭐ Meine Figur" for next time.

**Bluff-Lexikon** ✅ New category: invent definitions for very rare Latin/Greek nouns, find the real one – AI judge with polished answers, host reads the options, 200 words.

**Pixelpanik** ✅ New game: a picture sharpens from 4×4 pixels to full resolution – recognize it early for up to 200 points; free text with typo tolerance (Kids: four options), out on a wrong guess, own snarky host lines, pictures pre-rendered by a one-time script (Supabase Storage).

**Skurrile Ereignisse** ✅ New game on the bluff engine: 139 true, bizarre stories (Kids, Familie, Party) – invent the ending, find the truth; fact and source at the reveal.

**Führerscheinprüfung** ✅ New category: real traffic signs and junction scenes („Wer fährt zuerst?“) with a drive-through at the reveal, driving-instructor host and a BESTANDEN / DURCHGEFALLEN stamp at the end – 155 questions.

**Question statistics** ✅ Plays and 👍/👎 per question in D1, "⚠️ Stimmt nicht?" with undo, admin page `/admin/fragen` with quick filters and CSV, automatic AI replacement for removed questions.

**Milestone 0.3 – Show look & intro** ✅ Retro stage look on all screens, start page intro, host mascot, QR code via `NEXT_PUBLIC_SITE_URL`.
