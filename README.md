# Couch Clash 🛋️⚡

Couch Clash is a browser party game for the living room. One shared TV screen acts as the **host**, and everyone plays on their **phone**.
Later it will get category modules (quiz, estimation, drawing, bluffing, betting, music, AI content). **Milestone 0.1** contains only the lobby.

## Architecture

```
couch-clash/
├── apps/
│   ├── web/                 Next.js (App Router) + Tailwind → Vercel
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx                  Landing page ("Neues Spiel")
│   │       │   ├── host/[code]/              TV screen: code, QR, players, start
│   │       │   └── join/, join/[code]/       Enter code → name + avatar → waiting screen
│   │       ├── components/                   UI, avatar, avatar builder
│   │       └── lib/                          use-room (WebSocket), API, localStorage, config
│   └── party/               Cloudflare Worker + Durable Objects (PartyServer) → Cloudflare
│       ├── src/index.ts         HTTP API (create room / check room) + WebSocket routing
│       ├── src/room.ts          Durable Object "Room" (1 room = 1 game): storage, connections, alarm
│       ├── src/room-logic.ts    Pure room logic (join, reconnect, kick, start), fully tested
│       └── test/                Vitest tests for the room logic
└── packages/
    └── shared/              Shared TypeScript types + zod schemas
        └── src/
            ├── messages.ts      Client ↔ server messages (zod), error codes
            ├── state.ts         Room state, phases (lobby → setup → round → results → finale)
            ├── avatar.ts        Data-driven avatar parts (characters, colors, …)
            ├── codes.ts         Room codes (4 characters, no 0/O/1/I/L), secrets
            └── game-module.ts   Interfaces for future categories (GameModule, Category)
```

**How it works**

1. The host clicks "Neues Spiel". The web app calls `POST /api/rooms` on the worker. The worker generates a 4-character code and retries if the code is already taken. It initializes the Durable Object for that code and returns the code plus a secret **host token**. The web app stores the token in `localStorage`.
2. All clients connect via WebSocket to `/parties/room/<CODE>`. On every (re)connect the client sends a `hello_host` (with the token) or a `hello_player` (with its player id and secret).
3. **The room is authoritative.** Clients only send intents (`join`, `kick`, `start`). The room validates every one with zod, applies the rules and sends the public state to everyone. Secrets never appear in the state.
4. Room state lives in Durable Object storage. After 24 hours a DO alarm deletes the room.
5. **Reconnect:** after joining, the phone stores `playerId` and `playerSecret` per room in `localStorage`. A reload or a locked phone restores the same player, so no duplicate is created. The host screen shows each player as connected or disconnected.

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
   - **Project name:** `couch-clash-party`. This must match `name` in `apps/party/wrangler.jsonc`.
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
   - **Advanced settings → Root directory (path):** `apps/party`
4. Click **Create and deploy**. The first build takes 1–2 minutes.
5. Afterwards the worker is live at `https://couch-clash-party.<your-subdomain>.workers.dev`. Opening the URL should show "Couch Clash party server 🎉".
   Note the host part without `https://`. You need it for Vercel.

From now on, every push to `main` deploys the worker automatically. The Durable Object uses the SQLite backend, which also works on the free Workers plan.

### 2. Web app → Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the `couch-clash` repository.
2. Settings:
   - **Root Directory:** `apps/web`. Vercel then detects Next.js and pnpm on its own.
   - **Environment Variables:** `NEXT_PUBLIC_PARTY_HOST` = `couch-clash-party.<your-subdomain>.workers.dev` (without `https://`)
3. Click **Deploy**.

> `NEXT_PUBLIC_*` variables are baked into the build. If you change the value later, go to **Deployments** → **⋯** → **Redeploy**.

The option "Include source files outside of the Root Directory" must stay on (it is by default), because `apps/web` uses `packages/shared`.

## Environment variables

| Variable                 | Where               | Example                                    |
| ------------------------ | ------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_PARTY_HOST` | `apps/web`, Vercel  | `couch-clash-party.xyz.workers.dev`        |

The party worker currently needs no secrets. No secrets are committed to the repository.

## Status: milestone 0.1 (lobby)

- [x] Create a room (4-character code, retry on collision, host token)
- [x] Host screen with code, QR code, live player list, remove player, "Spiel starten" (only sets the phase)
- [x] Join by code, name (1–20 characters, unique ignoring case), avatar (character + color)
- [x] Waiting screen, reconnect without duplicates, connected/disconnected state
- [x] Joining only in the lobby, rooms expire after 24 hours, friendly error pages
- [x] zod validation for all messages, tests for the room logic
- [x] Interfaces for game modules and categories (no implementation yet)
