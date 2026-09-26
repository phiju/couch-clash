/**
 * End-to-end: one Musik-Quiz round with TV (1920×1080), one phone and two
 * test bots, played with the local synth test songs. Checks the flow
 * (question type → song → buzzer / year / kids choice → solution), that the
 * phone never gets the audio or the title early, and that the TV really
 * plays the clip. Needs `pnpm dev:party` with MUSIC_TEST_SONGS=1 in
 * apps/party/.dev.vars, and `pnpm dev:web`.
 *   MODE=family|kids SHOTS=./shots pnpm --filter @couch-clash/web e2e:musik
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;
const MODE = process.env.MODE ?? "family";
const SONGS = Number(process.env.SONGS ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, label) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
}
function ws(code, onMsg) {
  const sock = new WebSocket(`ws://${PARTY}/parties/room/${code}`);
  const opened = new Promise((resolve, reject) => {
    sock.addEventListener("open", resolve);
    sock.addEventListener("error", reject);
  });
  sock.addEventListener("message", (e) => e.data !== "pong" && onMsg(JSON.parse(e.data)));
  return { opened, send: (m) => sock.send(JSON.stringify(m)) };
}

// The test knows the songs (the phones don't): clip URL → song.
const songs = JSON.parse(readFileSync(new URL("../../../packages/content/data/musik/test-songs.json", import.meta.url), "utf8")).items;
const songByUrl = new Map(songs.map((s) => [s.previewUrl, s]));

const IDS = ["quiz", "estimate", "category-pick", "double-or-nothing", "bet", "steal", "fuehrerschein", "pixelpanik", "musik", "stadt-land-fluss", "bluff", "skurril", "survival"];
const SETUP = {
  order: IDS,
  choices: Object.fromEntries(IDS.map((id) => [id, { enabled: id === "musik", questionCount: SONGS }])),
  minutes: 15,
  plan: null,
  version: 2,
  finale: false,
};

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--autoplay-policy=no-user-gesture-required"] });
  const { code, hostToken } = await (await fetch(`http://${PARTY}/api/rooms`, { method: "POST" })).json();
  const watch = { host: null };
  const host = ws(code, (m) => m.type === "state" && (watch.host = m.state));
  await host.opened;
  host.send({ type: "hello_host", hostToken });
  await sleep(200);
  host.send({ type: "set_photo_avatars", enabled: false });

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await tvCtx.addInitScript(
    ([c, t, setup, mode]) => {
      localStorage.setItem(`couchclash:host:${c}`, JSON.stringify(t));
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("couchclash:setup", JSON.stringify(setup));
        localStorage.setItem("couchclash:game-mode", JSON.stringify({ mode, allow16: false, difficulty: "mixed" }));
      }
      sessionStorage.setItem("seeded", "1");
    },
    [code, hostToken, SETUP, MODE],
  );
  // Which clips the TV really started (the song player uses audio elements).
  await tvCtx.addInitScript(() => {
    window.__played = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes("/test-audio/")) window.__played.push(new URL(this.src).pathname);
      return play.call(this);
    };
  });
  const tv = await tvCtx.newPage();
  tv.on("pageerror", (e) => console.log("TV error:", e.message));
  const tvAudio = new Set();
  tv.on("request", (r) => r.url().includes("/test-audio/") && tvAudio.add(new URL(r.url()).pathname));
  await tv.goto(`${WEB}/host/${code}`);
  await tv.getByText("Mitspielen mit dem Code").waitFor();
  host.send({ type: "update_mode", mode: { mode: MODE, allow16: false, difficulty: "mixed" }, confirmAdult: true });
  check(await waitFor(() => watch.host?.mode?.mode === MODE), `mode ${MODE}`);

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => console.log("phone error:", e.message));
  const phoneAudio = [];
  phone.on("request", (r) => r.url().includes("/test-audio/") && phoneAudio.push(r.url()));
  const phoneStates = [];
  phone.on("websocket", (sock) => sock.on("framereceived", (f) => typeof f.payload === "string" && f.payload.startsWith("{") && phoneStates.push(f.payload)));
  await phone.goto(`${WEB}/join/${code}`);
  await phone.getByPlaceholder("z. B. Toni").fill("Philip");
  await phone.getByRole("button", { name: /Beitreten/ }).click();
  await phone.getByText("Du bist dabei!").waitFor();
  for (let i = 0; i < 2; i++) host.send({ type: "add_bot" });

  check(await waitFor(() => watch.host?.settingsSummary?.categoryIds.join() === "musik"), `settings: only Musik-Quiz (${MODE})`);
  await shot(tv, `${MODE}-0-lobby`);
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.host?.phase === "intro");
  await sleep(1200);
  await shot(tv, `${MODE}-1-intro`);
  host.send({ type: "skip" });
  const mod = () => (watch.host?.phase === "play" ? watch.host.game?.module : null);
  check(await waitFor(() => mod()?.step === "announce"), "previews loaded → first question type announced");

  for (let n = 0; n < SONGS && mod(); n++) {
    await waitFor(() => mod()?.step === "announce");
    const m = mod();
    await sleep(600);
    await shot(tv, `${MODE}-${n}-a-announce-${m.type}`);
    await shot(phone, `${MODE}-${n}-a-phone-announce`);
    check(await waitFor(() => mod()?.step === "play"), `song ${n + 1}: music (${m.input})`);
    const url = mod().clip.url;
    const song = songByUrl.get(url);
    check(!!song, `song ${n + 1}: TV has the clip ${url}`);
    await sleep(1500);
    check(tvAudio.has(url), `song ${n + 1}: the TV loads the audio`);
    check(await waitFor(() => tv.evaluate((u) => window.__played.includes(u), url)), `song ${n + 1}: the TV plays it`);
    await shot(tv, `${MODE}-${n}-b-play`);
    await shot(phone, `${MODE}-${n}-b-phone-play`);

    if (m.input === "buzzer") {
      // Bots may beat us – wait for the buzzer button.
      const buzz = phone.getByRole("button", { name: "BUZZ!" });
      if (await buzz.isVisible().catch(() => false)) {
        await buzz.dispatchEvent("pointerdown");
        const mine = await waitFor(() => mod()?.buzz?.playerId && watch.host.players.find((p) => p.id === mod().buzz.playerId)?.name === "Philip", 3_000);
        if (mine) {
          await sleep(400);
          await shot(tv, `${MODE}-${n}-c-buzzed`);
          await shot(phone, `${MODE}-${n}-c-phone-answer`);
          await phone.getByRole("textbox", { name: "Deine Antwort" }).fill(m.type === "artist" ? song.artist.toUpperCase() : song.title.toLowerCase());
          await phone.getByRole("button", { name: "Abschicken" }).click();
        }
      }
    } else if (m.input === "year") {
      await phone.getByRole("button", { name: "ein Jahr später" }).click();
      await phone.getByRole("button", { name: "Tipp abgeben" }).click();
    } else {
      await phone.getByRole("button", { name: new RegExp(song.title) }).click();
      await sleep(300);
      await shot(tv, `${MODE}-${n}-c-kids-answered`);
      await shot(phone, `${MODE}-${n}-c-phone-picked`);
    }
    if (!(await waitFor(() => mod()?.step === "reveal", 8_000))) host.send({ type: "skip" });
    check(await waitFor(() => mod()?.step === "reveal", 40_000), `song ${n + 1}: solution`);
    await sleep(1200);
    await shot(tv, `${MODE}-${n}-d-reveal`);
    await shot(phone, `${MODE}-${n}-d-phone-reveal`);
    host.send({ type: "skip" });
    await waitFor(() => mod()?.step === "leaderboard");
    host.send({ type: "skip" });
    await waitFor(() => mod()?.step !== "leaderboard" || watch.host?.phase !== "play");
  }

  check(phoneAudio.length === 0, "the phone never loads audio");
  const leaked = phoneStates.some((p) => {
    const s = JSON.parse(p).state?.game?.module;
    return s && !s.reveal && (s.clip?.url || (s.type !== "year" && s.shown));
  });
  check(!leaked, "the phone never gets the clip URL or the title before the solution");
  check(await waitFor(() => watch.host?.phase === "scoreboard" || watch.host?.phase === "finale", 20_000), "round over");
  await shot(tv, `${MODE}-9-scoreboard`);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
