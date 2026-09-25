/**
 * End-to-end: reconnecting and rejoining during a running game.
 *
 * A real browser player ("Philip") plus a scripted host and two bot players
 * over raw WebSockets. Player sockets run through a Playwright proxy so a
 * test can really drop them, refuse new ones (offline) or swallow all
 * traffic without closing (a WLAN ↔ mobile switch).
 *
 * Needs the party worker and the web app running:
 *   pnpm dev:party   (port 1999)   pnpm dev:web   (port 3000)
 *   pnpm --filter @couch-clash/web e2e:reconnect            # all quick cases
 *   CASES=b OFFLINE_SECONDS=30,180,900 pnpm --filter @couch-clash/web e2e:reconnect
 * Env: PARTY (127.0.0.1:1999), WEB (http://localhost:3000), PARTY_DIR (for
 * case f, restarts `wrangler dev`), CHROMIUM (browser path), SHOTS (folder
 * for screenshots), VIDEO (folder for phone screen recordings).
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const PORT = PARTY.split(":")[1];
const PARTY_DIR = process.env.PARTY_DIR ?? fileURLToPath(new URL("../../party", import.meta.url));
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;
/** Folder for screen recordings of the player's phones (webm), or null. */
const VIDEO = process.env.VIDEO ?? null;
const CASES = (process.env.CASES ?? "a,b,c,d,e,g,h,host,stuck,f").split(",");
const OFFLINE = (process.env.OFFLINE_SECONDS ?? "30").split(",").map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function check(ok, label, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` – ${detail}` : ""}`);
  return ok;
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

function ws(code, onMsg) {
  const sock = new WebSocket(`ws://${PARTY}/parties/room/${code}`);
  const opened = new Promise((resolve, reject) => {
    sock.addEventListener("open", resolve);
    sock.addEventListener("error", reject);
  });
  sock.addEventListener("message", (e) => {
    if (e.data !== "pong") onMsg(JSON.parse(e.data));
  });
  return { sock, opened, send: (m) => sock.send(JSON.stringify(m)) };
}

const scoring = { mode: "absolute", maxPoints: 100, speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 }, perQuestionCap: 200 };

/** Room + host (raw socket) + bots Anna and Ben. */
async function setupRoom() {
  const { code, hostToken } = await (await fetch(`http://${PARTY}/api/rooms`, { method: "POST" })).json();
  const host = { state: null, notices: [] };
  host.connect = async () => {
    host.c = ws(code, (m) => {
      if (m.type === "state") host.state = m.state;
      if (m.type === "notice") host.notices.push(`${m.notice.kind}:${m.notice.name}`);
    });
    await host.c.opened;
    host.c.send({ type: "hello_host", hostToken });
  };
  await host.connect();
  host.c.send({ type: "set_photo_avatars", enabled: false });
  const bots = [];
  for (const name of ["Anna", "Ben"]) {
    const bot = { name };
    bot.connect = async () => {
      let done;
      const ready = new Promise((r) => (done = r));
      bot.c = ws(code, (m) => {
        if (m.type === "joined" || m.type === "welcome_player") done(m);
      });
      await bot.c.opened;
      if (bot.id) bot.c.send({ type: "hello_player", playerId: bot.id, playerSecret: bot.secret });
      else bot.c.send({ type: "join", name, avatar: { character: "fox", color: "red" } });
      const m = await ready;
      if (m.type === "joined") Object.assign(bot, { id: m.playerId, secret: m.playerSecret });
    };
    await bot.connect();
    bots.push(bot);
  }
  return { code, hostToken, host, bots };
}

async function startGame(host) {
  host.c.send({ type: "update_settings", rounds: [{ categoryId: "quiz", questionCount: 15, scoring }] });
  await sleep(300);
  host.c.send({ type: "start_game" });
  await sleep(500);
  host.c.send({ type: "skip" }); // intro → first question
  await sleep(800);
}

const hostSees = (host, name) => {
  const p = host.state?.players.find((x) => x.name === name);
  return p ? (p.connected ? "connected" : "disconnected") : "missing";
};

const text = (page) => page.evaluate(() => document.body.innerText);

/** What the phone shows, roughly. */
async function phoneView(page) {
  const t = await text(page);
  if (/Beitreten geht nur/.test(t)) return "DEAD END";
  if (/Wer bist du/.test(t)) return "CLAIM SCREEN";
  if (/Verbinde mit Raum/.test(t)) return "CONNECTING";
  if (/Dein Name/.test(t)) return "JOIN FORM";
  return "IN GAME";
}

const inGame = async (page, host, name = "Philip") => (await phoneView(page)) === "IN GAME" && hostSees(host, name) === "connected";

async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}

async function run(which, seconds) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(VIDEO ? { recordVideo: { dir: VIDEO, size: { width: 390, height: 844 } } } : {}) };
  const ctx = await browser.newContext(phone);
  // All player sockets go through this proxy.
  const net = { offline: false, live: new Set(), lastConnectAt: 0 };
  await ctx.routeWebSocket(/\/parties\//, (client) => {
    if (net.offline) return void client.close({ code: 4999, reason: "offline" });
    const server = client.connectToServer();
    const pair = { client, server, blackhole: false };
    net.live.add(pair);
    net.lastConnectAt = Date.now();
    client.onMessage((m) => {
      if (!pair.blackhole) server.send(m);
    });
    server.onMessage((m) => {
      if (!pair.blackhole) client.send(m);
    });
    client.onClose(() => {
      net.live.delete(pair);
      server.close();
    });
    server.onClose(() => {
      net.live.delete(pair);
      client.close();
    });
  });
  const goOffline = () => {
    net.offline = true;
    for (const { client, server } of net.live) {
      server.close();
      client.close({ code: 4999, reason: "offline" });
    }
    net.live.clear();
  };

  let page = await ctx.newPage();
  const { code, hostToken, host, bots } = await setupRoom();
  await page.goto(`${WEB}/join/${code}`);
  await page.getByPlaceholder("z. B. Toni").fill("Philip");
  await page.getByRole("button", { name: /Beitreten/ }).click();
  await waitFor(() => hostSees(host, "Philip") === "connected", 10_000);
  await startGame(host);

  try {
    switch (which) {
      case "a":
        await page.reload();
        check(await waitFor(() => inGame(page, host), 8_000), "a) reload mid-question");
        break;

      case "b": {
        const cdp = await ctx.newCDPSession(page);
        goOffline();
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
        await sleep(3_000);
        const blip = hostSees(host, "Philip");
        await sleep(Math.min(seconds, 25) * 1000 - 3_000);
        const later = hostSees(host, "Philip");
        await sleep(Math.max(0, seconds - 25) * 1000);
        net.offline = false;
        await cdp.send("Page.setWebLifecycleState", { state: "active" });
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        const back = Date.now();
        const ok = await waitFor(() => inGame(page, host), 10_000);
        check(blip === "connected", `b) ${seconds} s offline: a short drop changes nothing (grace period)`, `after 3 s: ${blip}`);
        if (seconds >= 25) check(later === "disconnected", `b) ${seconds} s offline: 📵 after the grace period`, `after 25 s: ${later}`);
        check(ok, `b) ${seconds} s offline (socket gone, phone frozen), back when visible`, `${((Date.now() - back) / 1000).toFixed(1)} s`);
        break;
      }

      case "c":
        await page.close();
        await sleep(2_000);
        page = await ctx.newPage();
        await page.goto(`${WEB}/join/${code}`);
        check(await waitFor(() => inGame(page, host), 8_000), "c) tab closed, join link opened again (same browser)");
        break;

      case "d": {
        await page.close();
        await sleep(2_000);
        const other = await browser.newContext(phone);
        const second = await other.newPage();
        await second.goto(`${WEB}/join/${code}`);
        await waitFor(async () => (await phoneView(second)) === "CLAIM SCREEN", 8_000);
        await shot(second, "phone-claim");
        await sleep(VIDEO ? 1_500 : 0);
        await second.getByRole("button", { name: "Philip" }).click();
        check(await waitFor(() => inGame(second, host), 8_000), "d) other browser, no credentials: tap your name → back in");
        await sleep(VIDEO ? 2_000 : 0);
        check(host.notices.includes("rejoined:Philip"), "d) the TV shows „Philip ist wieder da 👋“");
        // The original browser: its old secret is invalid, and Philip is connected elsewhere → not offered.
        const again = await ctx.newPage();
        await again.goto(`${WEB}/join/${code}`);
        await waitFor(async () => (await phoneView(again)) === "CLAIM SCREEN", 8_000);
        check((await again.getByRole("button", { name: "Philip" }).count()) === 0, "d) old credentials no longer work, the connected seat can't be taken");
        await other.close();
        break;
      }

      case "e":
        await page.evaluate((c) => {
          const k = `couchclash:player:${c}`;
          const creds = JSON.parse(localStorage.getItem(k));
          localStorage.setItem(k, JSON.stringify({ ...creds, playerSecret: "x".repeat(creds.playerSecret.length) }));
        }, code);
        // The cookie fallback holds the right secret – drop it too, so the server really answers UNKNOWN_PLAYER.
        await ctx.clearCookies();
        await page.reload();
        await waitFor(async () => (await phoneView(page)) === "CLAIM SCREEN", 8_000);
        await page.getByRole("button", { name: "Philip" }).click();
        check(await waitFor(() => inGame(page, host), 8_000), "e) stored credentials rejected (UNKNOWN_PLAYER) → claim screen → back in");
        break;

      case "cookie": {
        // In-app browsers that drop localStorage: the cookie brings the player back.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        check(await waitFor(() => inGame(page, host), 8_000), "cookie) localStorage wiped, fallback cookie → back in");
        break;
      }

      case "g": {
        const other = await browser.newContext(phone);
        const tina = await other.newPage();
        await tina.goto(`${WEB}/join/${code}`);
        await waitFor(async () => (await phoneView(tina)) === "CLAIM SCREEN", 8_000);
        check((await tina.getByRole("button", { name: "Philip" }).count()) === 0, "g) a connected player's seat is not offered to another phone");
        await tina.getByRole("button", { name: "Als neuer Spieler mitspielen" }).click();
        await tina.getByPlaceholder("z. B. Toni").fill("Tina");
        await tina.getByRole("button", { name: /Beitreten/ }).click();
        const waiting = await waitFor(async () => /ab der nächsten spielst du mit/.test(await text(tina)), 8_000);
        await shot(tina, "phone-late-join-waiting");
        const t = host.state.players.find((p) => p.name === "Tina");
        check(!!t && waiting && host.state.game.scores[t.id] === 0, "late join: 0 points, waits for the next question");
        check(host.notices.includes("late_join:Tina"), "late join: the TV shows „Neu dabei: Tina“");
        const start = host.state.game.module.index;
        for (let i = 0; i < 8 && !(host.state.game.module?.index > start && host.state.game.module?.step === "question"); i++) {
          host.c.send({ type: "skip" });
          await sleep(1_200);
        }
        check(await waitFor(async () => !/ab der nächsten/.test(await text(tina)) && (await phoneView(tina)) === "IN GAME", 5_000), "late join: plays from the next question");
        break;
      }

      case "h": {
        // WLAN ↔ mobile: the old connection dies silently – no close on either side.
        const cut = Date.now();
        for (const pair of net.live) pair.blackhole = true;
        const back = await waitFor(() => net.lastConnectAt > cut, 40_000);
        const secs = ((net.lastConnectAt - cut) / 1000).toFixed(1);
        await sleep(1_500);
        const before = await text(page);
        host.c.send({ type: "skip" });
        const follows = await waitFor(async () => (await text(page)) !== before, 5_000);
        check(back && follows, "h) network switch (dead socket, no close): heartbeat finds it, phone follows the game", back ? `new socket after ${secs} s` : "never");
        break;
      }

      case "host": {
        const tvCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        await tvCtx.addInitScript(([c, t]) => localStorage.setItem(`couchclash:host:${c}`, JSON.stringify(t)), [code, hostToken]);
        const tv = await tvCtx.newPage();
        await tv.goto(`${WEB}/host/${code}`);
        await sleep(3_000);
        await tv.reload();
        const ok = await waitFor(async () => /Frage \d+ \/ \d+/.test(await text(tv)), 10_000);
        check(ok, "host) the TV reloads mid-game and is back in the question");
        // Philip's phone is gone → 📵 on the TV after the grace period; he comes back → toast.
        goOffline();
        await sleep(22_000);
        await shot(tv, "tv-offline-marker");
        check(hostSees(host, "Philip") === "disconnected", "host) a phone gone for 20+ s is marked (📵)");
        net.offline = false;
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await waitFor(async () => /ist wieder da/.test(await text(tv)), 8_000);
        await shot(tv, "tv-toast-rejoined");
        await tv.keyboard.press("q");
        await sleep(500);
        await shot(tv, "tv-join-qr-big");
        check(/Wieder rein oder neu dabei/.test(await text(tv)), "host) corner chip: Q enlarges the QR code");
        break;
      }

      case "stuck": {
        goOffline();
        await page.reload();
        const hint = await waitFor(async () => /Neu verbinden/.test(await text(page)), 12_000);
        await shot(page, "phone-stuck-hint");
        net.offline = false;
        await page.getByRole("button", { name: "Neu verbinden" }).first().click();
        check(hint && (await waitFor(() => inGame(page, host), 8_000)), "stuck) „Neu verbinden“ after 8 s, retries go on, button reconnects");
        break;
      }

      case "f": {
        // Restart the worker: Durable Objects lose their memory, storage stays (.wrangler/state).
        const pids = execSync(`pgrep -f 'wrangler.*dev --port ${PORT}' || true`).toString().trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGTERM");
          } catch {
            // already gone
          }
        }
        await sleep(3_000);
        spawn("npx", ["wrangler", "dev", "--port", PORT, "--ip", "127.0.0.1"], { cwd: PARTY_DIR, detached: true, stdio: "ignore" }).unref();
        await waitFor(async () => fetch(`http://${PARTY}/api/rooms/${code}`).then(() => true, () => false), 60_000);
        await host.connect();
        for (const b of bots) await b.connect().catch(() => {});
        const back = await waitFor(() => inGame(page, host), 20_000);
        const s = host.state;
        check(back && s.phase === "play" && s.players.length === 3, "f) worker restarted (Durable Object evicted): room, players, scores and phase restored, phone back");
        break;
      }
    }
  } finally {
    await browser.close();
    for (const b of bots) b.c.sock.close();
    host.c.sock.close();
  }
}

for (const which of CASES) {
  if (which === "b") for (const s of OFFLINE) await run("b", s);
  else await run(which, 0);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
