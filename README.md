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
│       ├── src/admin/               Admin API for /admin/fragen (ADMIN_TOKEN)
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
4. **Settings live in the room.** The host picks categories, question counts and scoring in the lobby while players join (`update_settings`, host only, zod-validated, defaults from the host's `localStorage`). Players only see a short summary. "Spiel starten" goes straight to the first category. The separate setup screen is only used for "Nochmal spielen".
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
5. **Optional hooks:** `minPlayers` in the meta (not selectable below it), `pendingTask`/`resolveTask` for server work such as an AI check (the room runs it generically, `null` on timeout – the module falls back), `readAloud` for texts the host reads out (one voice clip per item, the category highlights the item via the line's `cue`), `revealFacts`/`toStats` for commentary and statistics.

## Game modes (Kids / Familie / Party)

One global setting at the top of the host settings decides who is playing (default Familie, remembered on the device and stored in the room):

| | Kids | Familie | Party |
|---|---|---|---|
| Questions | age ≤ 6, difficulty 1, no alcohol, nothing adult | age ≤ 12 (16 if allowed), nothing adult | everything |
| Difficulty mix | – | leicht / gemischt / schwer | leicht / gemischt / schwer |
| Host "Frechheit" | nett (or frech) | frech (nett / frech / gnadenlos) | frech (nett / frech / gnadenlos) |

- Party asks once per room: „Party-Modus: Nur für Erwachsene – sind alle über 18?“. The host voice may make suggestive (never explicit) jokes only in Party; the hard limits stay in every mode.
- Categories declare `modes` in their metadata (Bluff-Lexikon: Familie + Party). Content items have `alcohol` and `adult` flags (default false). `eligibleForMode()` in `@couch-clash/shared` is the one filter every category's pool goes through; Familie/Party weight the selection by difficulty.
- The settings panel lists only categories of the current mode, warns when a mode has fewer questions than a round allows and caps the slider.
- **Zufall + Spieldauer** (15–90 min): `planGame()` in `packages/games/src/planner.ts` builds a random plan within ±10 % of the target (overheads in `DURATION_CONFIG`), alternating quick and slow categories, a slow one last, repeating a category (never back to back) when the game is long or the mode has few categories. Manual changes switch to „manuell“.

## Bluff-Lexikon

A very rare, real German noun – mostly Latin/Greek terms from medicine, biology, law, architecture, linguistics, book arts, music, geology and astronomy (200 in `packages/content/data/bluff.de.json`, each with article; at most ~5 % of adults know them). The screen asks „Ein Borborygmus ist …?“ / „Vibrissen sind …?“. Per word:

1. **Write** (60 s): everyone invents a believable definition on the phone (max 80 characters).
2. **Check** (invisible, max 6 s, strong model): the judge compares every definition with the real one and returns verdict, confidence and a short reason (logs only):
   - captures the core meaning (even vaguer or colloquial: „Wenn's weh tut“ ≈ „kleine Wehwehchen“) → „Gewusst!“ (+100), merged into the real answer, never shown; a „correct“ below confidence 0.6 counts as a bluff,
   - near-identical bluffs are merged, offensive ones removed,
   - every bluff is **polished** close to the player's wording (things with article, actions as „Wenn jemand …“, no filler/slang/typos); a polished text that is empty, too long or changes the idea (`sameIdea: false`) is replaced by a light local cleanup.
   Only anonymous texts (s1, s2, …) are sent. If the judge fails, a local check (equality / containment with the real definition) runs before the options are shown.
3. **Present:** options A, B, C, … – only polished texts (TV, phone, voice), all in the same style. The host reads them out.
4. **Vote** (30 s), then **reveal** („Ein Borborygmus ist: …“). Host option (default off): show the authors' original texts („Philip schrieb: …“).

Scoring (strategy `bluff`, no speed bonus): real definition found +100, +50 per player who fell for your definition, correct definition written +100. Needs at least 2 players.

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
- **Phone:** name → "📸 Selfie machen" / "🖼️ Foto wählen" / "😀 Emoji nehmen". A one-time consent note appears (remembered in `localStorage`). The phone crops the photo to a centered square (max 512 px, JPEG 0.8; re-encoding strips EXIF) and shows a preview. **Nothing is uploaded before "Verwandeln!"**. The player joins right away with the emoji and sees the waiting screen, then "Passt!" / "Nochmal" (max 2 re-generations). Errors, the 90 s timeout and safety refusals keep the emoji (or the previous image).
- **Worker:** `POST /api/rooms/:code/avatar` (multipart `playerId`, `playerSecret`, `photo`; ≤ 1 MB; JPEG/PNG/WebP, checked by the file bytes). The room sets the avatar's `photo.status` to `pending` and generates in the background (`ctx.waitUntil`). Every client gets `pending → ready | failed` over the room WebSocket. After "Passt!", 3 expressions are generated in the background (jubelnd / enttäuscht / geschockt). The animated leaderboard shows them when a player moves up, moves down, or loses big.
- **Limits per room:** 16 players × (1 + 2) base images, 16 × 3 expressions, and one job per player at a time. The API returns clear errors (409 busy, 429 limit, 413 too large, 415 wrong type, 401 auth, 404 room).
- **Host:** lobby switch "📸 Foto-Avatare erlauben" (default on), "↺ Emoji" on each player card, and a sparkle plus `sting-short` when a photo avatar is ready.

**Keep the figure ("⭐ Figur fürs nächste Mal behalten")**
- After "Passt!", the player can tick the checkbox (opt-in), or tap the button in the lobby later.
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

The mascot welcomes every player by name and comments on the leaderboard. Every line is generated live, and the host device only plays it through the audio manager. The music is ducked; the voice has its own gain, clearly louder than the music, and the master volume still applies.

- **Text:** OpenAI **`gpt-4.1-mini`**.
- **Voice:** **ElevenLabs**, voice `DQ4rTqXxHr077oQgsA9D`, mp3 44.1 kHz / 128 kbps.
  - `eleven_v3` (expressive, audio tags) for welcome, game start, winner announcement and the test line.
  - `eleven_flash_v2_5` (fast) for leaderboard comments.
  - Voice settings: stability 0.35 (v3: preset 0.5 "natural"), similarity 0.8, style 0.6, speaker boost.
- The OpenAI voice stays in the code: `VOICE_PROVIDER = "openai"` in `apps/party/src/voice/config.ts`.

**No speech bubbles:** the host never shows bubbles or subtitles. He only sways (idle) and bounces slightly while the voice plays. A line that can't be heard is skipped.

**When he speaks**
- **Welcome:** one short line per joining player. At most 3 welcome lines wait on the TV; further names are merged into one line.
- **Game start:** with the number of players.
- **Commentary:** prepared at the reveal from structured facts (answers, right/wrong, estimate vs. correct value, rank changes, fastest answer, streaks).
  - It plays when the leaderboard starts or is skipped; a line still playing may keep the leaderboard up to 3 s longer.
  - "Kommentare": `oft` = every 2nd question, `normal` = every 3rd, `selten` = only after the last question of a category. The last question of a category is always commented.
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
- Per room: **3,000 characters** for the voice (`charBudgetPerRoom`; the ElevenLabs free tier has 10,000 per month). Only the characters actually sent are counted, and test lines count too.
- Per room: max 60 generated texts; after that, template lines are spoken.
- Quota exceeded / 401 / 402 / 429 / voice not available → the voice stops for this room, the game continues silently, and the settings panel shows "Moderator-Stimme gerade nicht verfügbar (ElevenLabs-Kontingent?)". Only the error code is logged.
- Timeouts: text 4 s, speech 8 s. A comment that isn't ready in time is skipped.

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

**Storage:** the mp3s live in R2 under `rooms/<code>/voice/<id>.mp3`, are deleted with the room, and are covered by the 1-day rule on `rooms/`.

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
- [x] Game flow: intro → questions with timer (ends early when everyone answered) → reveal → scoreboard → finale → "Nochmal spielen"
- [x] "Wissensfragen" (multiple choice) and "Schätzfragen" (numbers) with configurable scoring
- [x] 43 quiz and 31 estimate questions (German), no repeats within a room
- [x] Per-viewer state: no answers leak before the reveal
- [x] Game settings directly in the lobby, summary on the players' phones
- [x] Animated leaderboard after every question (TV + phones), reused for scoreboard and final ranking

**Milestone 0.4 – Welcome screen, sound & laptop layout** ✅ Welcome card with "Los geht's!", host audio engine (jingle, loops, stings, fanfare), all host screens fit 1280×720 … 4K without scrolling.

**The host speaks (AI voice)** ✅ Welcome by name, game start, leaderboard commentary with "Frechheit" levels, winner announcement – voice by ElevenLabs, host device only, no speech bubbles, character budget per room.

**Photo avatars (AI)** ✅ Selfie/photo → cartoon in the show style via OpenAI, 3 expressions for the leaderboard, emoji fallback, R2 storage with cleanup, "⭐ Meine Figur" for next time.

**Bluff-Lexikon** ✅ New category: invent definitions for very rare Latin/Greek nouns, find the real one – AI judge with polished answers, host reads the options, 200 words.

**Question statistics** ✅ Plays and 👍/👎 per question in D1, "⚠️ Stimmt nicht?" with undo, admin page `/admin/fragen` with quick filters and CSV, automatic AI replacement for removed questions.

**Milestone 0.3 – Show look & intro** ✅ Retro stage look on all screens, start page intro, host mascot, QR code via `NEXT_PUBLIC_SITE_URL`.
