/**
 * End-to-end: a short quiz, then the Survival-Finale with test bots.
 * Host TV (1920×1080) + one phone. Needs `pnpm dev:party` and `pnpm dev:web`.
 *   SHOTS=./shots pnpm --filter @couch-clash/web e2e:survival
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;
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

const scoring = { mode: "absolute", maxPoints: 100, speedModifier: { enabled: false, fastestMultiplier: 1.5, slowestMultiplier: 0.5 }, perQuestionCap: 200 };
const IDS = ["quiz", "estimate", "category-pick", "double-or-nothing", "bet", "steal", "fuehrerschein", "bluff", "skurril", "survival"];
const SETUP = {
  order: IDS,
  choices: Object.fromEntries(IDS.map((id) => [id, { enabled: id === "quiz", questionCount: 3, scoring: id === "quiz" ? scoring : undefined }])),
  minutes: 15,
  plan: null,
  version: 2,
  finale: true,
};

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const { code, hostToken } = await (await fetch(`http://${PARTY}/api/rooms`, { method: "POST" })).json();
  const watch = { state: null };
  await ws(code, (m) => m.type === "state" && (watch.state = m.state)).opened;
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
    [code, hostToken, SETUP],
  );
  const tv = await tvCtx.newPage();
  tv.on("pageerror", (e) => console.log("TV error:", e.message));
  await tv.goto(`${WEB}/host/${code}`);
  await tv.getByText("Mitspielen mit dem Code").waitFor();
  await shot(tv, "0-lobby-settings");

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => console.log("phone error:", e.message));
  await phone.goto(`${WEB}/join/${code}`);
  await phone.getByPlaceholder("z. B. Toni").fill("Philip");
  await phone.getByRole("button", { name: /Beitreten/ }).click();
  await phone.getByText("Du bist dabei!").waitFor();
  for (let i = 0; i < 4; i++) host.send({ type: "add_bot" });

  check(await waitFor(() => watch.state?.settingsSummary?.categoryIds.join() === "quiz,survival"), "settings: quiz + Survival-Finale last");
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.state?.phase === "intro");
  host.send({ type: "skip" });

  // The quiz: bots answer on their own; the phone answers the first option.
  let sawScoreboard = false;
  for (let guard = 0; guard < 300 && !(watch.state?.phase === "intro" && watch.state.game?.roundIndex === 1); guard++) {
    if (watch.state?.phase === "scoreboard") sawScoreboard = true;
    if (watch.state?.game?.module?.step === "question") await phone.locator("button").filter({ hasText: /\S/ }).first().click({ timeout: 500 }).catch(() => {});
    await sleep(300);
    if (watch.state?.phase === "play" && watch.state.game?.module?.step !== "question") host.send({ type: "skip" });
  }
  console.log("main game:", JSON.stringify(watch.state?.game?.scores));
  check(!sawScoreboard, "no standings between the last normal round and the finale");
  await tv.getByText("Bis nur noch einer übrig ist").waitFor();
  await shot(tv, "1-category-intro");
  host.send({ type: "skip" });

  const survival = () => (watch.state?.phase === "play" ? watch.state.game?.module : null);
  check(await waitFor(() => survival()?.step === "intro"), "finale intro (rules)");
  await sleep(3000);
  await shot(tv, "2-intro-rules");
  await shot(phone, "2-intro-phone");

  // Start sequence: everyone low with the main-game points, the moderator (here: no voice), then the ride.
  check(await waitFor(() => survival()?.step === "launch", 20_000), "start sequence after the rules");
  await sleep(300);
  await shot(tv, "3-launch-low");
  check(await waitFor(() => survival()?.launch?.riseAt != null, 10_000), "the ride starts (no voice: right after the pause)");
  const { riseAt, riseMs } = survival().launch;
  await waitFor(() => Date.now() >= riseAt + riseMs * 0.45, 8_000);
  await shot(tv, "3-launch-ride");
  check(await waitFor(() => survival()?.step === "question", 10_000), "first question right after the ride");
  const firstAt = survival()?.question?.startedAt ?? 0;
  check(Math.abs(firstAt - (riseAt + riseMs)) < 300, `first question when the ride is over (${firstAt - riseAt} ms after the start)`);

  const seen = new Set();
  let winnerSince = null;
  let decayShot = false;
  let eliminations = 0;
  const end = Date.now() + 9 * 60_000;
  while (Date.now() < end && watch.state?.phase !== "finale") {
    const s = survival();
    if (s?.step === "winner" && winnerSince === null) winnerSince = Date.now();
    if (s) {
      const key = `${s.step}:${s.question?.number ?? ""}:${s.phaseIndex}`;
      const out = s.players.filter((p) => p.eliminated).length;
      if (!seen.has(key) && ["reveal", "phase_change", "sudden_death", "tiebreak", "tiebreak_reveal", "winner"].includes(s.step)) {
        seen.add(key);
        if (s.step !== "reveal" || seen.size < 4 || out !== eliminations) {
          await sleep(s.step === "reveal" ? 1800 : 900);
          await shot(tv, `4-${String(seen.size).padStart(2, "0")}-${s.step}${s.question ? `-q${s.question.number}` : ""}`);
          if (s.step === "winner") await shot(phone, "6-winner-phone");
        }
        eliminations = out;
      }
      // First finale question: the phone doesn't answer – its elevator melts live after the decay threshold.
      if (s.step === "question" && s.question && !decayShot) {
        decayShot = true;
        const at = s.question.decayFrom + 2_600;
        await waitFor(() => Date.now() >= at || survival()?.step !== "question", 25_000);
        if (survival()?.step === "question") {
          await shot(tv, "5-live-decay");
          await shot(phone, "5-live-decay-phone");
        }
      }
    }
    // Every step runs on its own server timer – the host never skips here.
    await sleep(150);
  }
  const final = watch.state;
  check(final?.phase === "finale", "finale reached");
  if (winnerSince !== null) {
    const ms = Date.now() - winnerSince;
    check(ms < 8_500, `winner → ceremony without waiting (${ms} ms; no voice: ride + short cheer)`);
  }
  check(final?.game?.rankedFinale === true, "finale placed by the Survival-Finale");
  await sleep(1500);
  await shot(tv, "7-finale-tv");
  await shot(phone, "7-finale-phone");
  console.log("ranking:", JSON.stringify(final?.game?.leaderboard?.map((e) => [e.playerId.slice(0, 4), e.rankAfter, e.scoreAfter])));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
