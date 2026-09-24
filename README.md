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

The room, lobby, setup screen, scoreboard and finale pick up the new category automatically.

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
   - **Deploy command:** `cd apps/party && npx wrangler deploy`
   - **Root directory (path):** `/`
4. Click **Create and deploy**.
5. Afterwards the worker is live at `https://couch-clash.<your-subdomain>.workers.dev`. Opening the URL should show "Couch Clash party server 🎉".
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

The party worker currently needs no secrets. No secrets are committed to the repository.

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

**Milestone 0.3 – Show look & intro** ✅ Retro stage look on all screens, start page intro, host mascot, QR code via `NEXT_PUBLIC_SITE_URL`.
