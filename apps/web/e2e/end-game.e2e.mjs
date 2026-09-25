/**
 * End-to-end: "Spiel beenden" → short award ceremony → lobby.
 *
 * Host TV (1920×1080) and one phone in real browsers, three bot players over
 * raw WebSockets. Needs `pnpm dev:party` (1999) and `pnpm dev:web` (3000).
 *   SHOTS=./shots pnpm --filter @couch-clash/web e2e:end-game
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(ok, label) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
async function waitFor(fn, ms = 10_000) {
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
  sock.addEventListener("message", (e) => {
    if (e.data !== "pong") onMsg(JSON.parse(e.data));
  });
  return { opened, send: (m) => sock.send(JSON.stringify(m)), close: () => sock.close() };
}

const scoring = { mode: "absolute", maxPoints: 100, speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 }, perQuestionCap: 200 };
const COLORS = ["red", "blue", "green"];
const CATEGORY_IDS = ["quiz", "estimate", "category-pick", "double-or-nothing", "bet", "steal", "fuehrerschein", "bluff", "skurril"];
/** The TV's remembered settings ("manuell"): only Wissensfragen, 5 questions. */
const QUIZ_ONLY = {
  order: CATEGORY_IDS,
  choices: Object.fromEntries(CATEGORY_IDS.map((id) => [id, { enabled: id === "quiz", questionCount: 5, scoring: id === "quiz" ? scoring : undefined }])),
  minutes: 15,
  plan: null,
  version: 2,
};

async function room() {
  const { code, hostToken } = await (await fetch(`http://${PARTY}/api/rooms`, { method: "POST" })).json();
  // A watcher socket (guest) just to read the state.
  const watch = { state: null };
  const w = ws(code, (m) => m.type === "state" && (watch.state = m.state));
  await w.opened;
  return { code, hostToken, watch, closeWatch: w.close };
}

async function bot(code, name, i) {
  const b = { name };
  let done;
  const ready = new Promise((r) => (done = r));
  b.c = ws(code, (m) => {
    if (m.type === "joined") done(m);
  });
  await b.c.opened;
  b.c.send({ type: "join", name, avatar: { character: "fox", color: COLORS[i % COLORS.length] } });
  const m = await ready;
  b.id = m.playerId;
  return b;
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const { code, hostToken, watch } = await room();

  // Host commands go through a second host connection (the TV shows the same room).
  const host = ws(code, () => {});
  await host.opened;
  host.send({ type: "hello_host", hostToken });
  await sleep(200);
  host.send({ type: "set_photo_avatars", enabled: false });

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await tvCtx.addInitScript(
    ([c, t, setup]) => {
      localStorage.setItem(`couchclash:host:${c}`, JSON.stringify(t));
      if (!sessionStorage.getItem("seeded")) localStorage.setItem("couchclash:setup", JSON.stringify(setup));
      sessionStorage.setItem("seeded", "1");
    },
    [code, hostToken, QUIZ_ONLY],
  );
  const tv = await tvCtx.newPage();
  await tv.goto(`${WEB}/host/${code}`);
  await tv.getByText("Mitspielen mit dem Code").waitFor();

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(`${WEB}/join/${code}`);
  await phone.getByPlaceholder("z. B. Toni").fill("Philip");
  await phone.getByRole("button", { name: /Beitreten/ }).click();
  await phone.getByText("Du bist dabei!").waitFor();

  const bots = [];
  for (const [i, name] of ["Anna", "Ben", "Clara", "Dieter"].entries()) bots.push(await bot(code, name, i));

  await waitFor(() => watch.state?.settingsSummary?.categoryIds.join() === "quiz");
  await sleep(500);
  const settingsBefore = JSON.stringify(watch.state?.settingsSummary);
  console.log("settings:", settingsBefore);
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.state?.phase === "intro");
  host.send({ type: "skip" });

  // Three questions – somebody is right each time.
  for (let q = 0; q < 3; q++) {
    await waitFor(() => watch.state?.phase === "play" && watch.state.game?.module?.step === "question");
    // Everyone guesses – usually a podium with different scores (the answer is secret).
    bots.forEach((b, i) => b.c.send({ type: "action", action: { type: "answer", value: (i + q + Math.floor(Math.random() * 4)) % 4 } }));
    await phone.locator("button").filter({ hasText: /\S/ }).first().click().catch(() => {});
    await waitFor(() => watch.state?.game?.module?.step === "reveal");
    host.send({ type: "skip" }); // → leaderboard
    await waitFor(() => watch.state?.game?.module?.step === "leaderboard");
    host.send({ type: "skip" }); // → next question
  }
  await waitFor(() => watch.state?.game?.module?.step === "question");
  const scores = watch.state.game.scores;
  check(Object.values(scores).some((s) => s > 0), `somebody scored (${JSON.stringify(scores)})`);

  // "Spiel beenden" → confirm dialog.
  await tv.getByRole("button", { name: "Spiel beenden" }).click();
  await tv.getByRole("dialog").waitFor();
  check(await tv.getByText("Es gibt eine Siegerehrung mit dem aktuellen Stand.").isVisible(), "confirm dialog explains the ceremony");
  await shot(tv, "1-confirm");
  await tv.getByRole("button", { name: "Weiter spielen" }).click();
  check((await tv.getByRole("dialog").count()) === 0 && watch.state.phase === "play", "Weiter spielen keeps playing");
  await tv.getByRole("button", { name: "Spiel beenden" }).click();
  await tv.getByRole("button", { name: "Beenden", exact: true }).click();

  check(await waitFor(() => watch.state?.phase === "finale"), "early end → finale");
  check(JSON.stringify(watch.state.game.scores) === JSON.stringify(scores), "finale with the current scores (running question dropped)");
  await tv.getByText("Spiel beendet – Zwischenstand").waitFor();
  await phone.getByText(/Platz \d von 5 – /).waitFor();
  check(true, "TV headline + phone place");
  await sleep(1200);
  await shot(tv, "2-early-finale-tv");
  await shot(phone, "2-early-finale-phone");

  // Host reload during the early finale.
  await tv.reload();
  check(
    await tv.getByText("Spiel beendet – Zwischenstand").waitFor({ timeout: 10_000 }).then(() => true, () => false),
    "host reload keeps the ceremony",
  );

  await tv.getByRole("button", { name: /Weiter/ }).click();
  check(await waitFor(() => watch.state?.phase === "lobby"), "Weiter → lobby");
  await tv.getByText("Mitspielen mit dem Code").waitFor();
  check(watch.state.players.length === 5, "all players stay");
  check(watch.state.game === null, "scores reset");
  await sleep(1500); // the TV's settings panel re-sends its (restored) settings
  check(JSON.stringify(watch.state.settingsSummary) === settingsBefore, "settings kept");
  check((await tv.locator("#lobby-settings").getAttribute("aria-hidden")) === "true", "settings panel collapsed");
  await phone.getByText("Warte auf das nächste Spiel …").waitFor();
  await sleep(800);
  await shot(tv, "3-lobby-after-tv");
  await shot(phone, "3-lobby-after-phone");

  // No points yet: straight back with a toast.
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.state?.phase === "intro");
  await tv.getByRole("button", { name: "Spiel beenden" }).click();
  check(await tv.getByText("Noch hat niemand Punkte").isVisible(), "no-points dialog text");
  await tv.getByRole("button", { name: "Beenden", exact: true }).click();
  check(await waitFor(() => watch.state?.phase === "lobby"), "no points → lobby");
  await tv.getByText("🏁 Spiel beendet", { exact: true }).waitFor();
  check(true, "toast 'Spiel beendet'");
  await sleep(700);
  await shot(tv, "4-no-points-toast");

  // Regular finale → lobby.
  await sleep(1500);
  check(JSON.stringify(watch.state.settingsSummary) === settingsBefore, "settings still kept");
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  for (let guard = 0; guard < 200 && watch.state?.phase !== "finale"; guard++) {
    if (watch.state?.game?.module?.step === "question") bots.forEach((b, i) => b.c.send({ type: "action", action: { type: "answer", value: i % 4 } }));
    await sleep(150);
    host.send({ type: "skip" });
    await sleep(250);
  }
  check(watch.state.phase === "finale" && !watch.state.game.endedEarly, `regular finale (${watch.state.phase} ${watch.state.game?.module?.step})`);
  await tv.getByRole("button", { name: "Zurück zur Lobby" }).waitFor();
  await sleep(1000);
  await shot(tv, "5-regular-finale-tv");
  await tv.getByRole("button", { name: "Zurück zur Lobby" }).click();
  check(await waitFor(() => watch.state?.phase === "lobby"), "regular finale → lobby");

  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
