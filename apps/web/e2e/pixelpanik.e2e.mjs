/**
 * End-to-end: one Pixelpanik round (5 pictures) with TV (1920×1080), one
 * phone and two test bots. Checks that the TV never loads a later stage (or
 * the full picture) early and that the phone never loads a picture.
 * Needs `pnpm dev:party` and `pnpm dev:web`, and motifs with pictures
 * (the image script). The phone answers right at stage 2 (8×8).
 *   MODE=family|party|kids SHOTS=./shots pnpm --filter @couch-clash/web e2e:pixelpanik
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;
const MODE = process.env.MODE ?? "family";
/** A Kids option button: "▲ Italien" (shape + text). */
const option = (text) => new RegExp(`^\\S+\\s+${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
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

// The test knows the answers from the data file (the TV doesn't): picture URL → motif.
const motifs = JSON.parse(readFileSync(new URL("../../../packages/content/data/pixelpanik/motive.json", import.meta.url), "utf8")).items;
const motifByStage = new Map(motifs.flatMap((m) => (m.image?.stages ?? []).map((url, i) => [url, { motif: m, stage: i }])));

const IDS = ["quiz", "estimate", "category-pick", "double-or-nothing", "bet", "steal", "fuehrerschein", "pixelpanik", "bluff", "skurril", "survival"];
const SETUP = {
  order: IDS,
  choices: Object.fromEntries(IDS.map((id) => [id, { enabled: id === "pixelpanik", questionCount: 5 }])),
  minutes: 15,
  plan: null,
  version: 2,
  finale: false,
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
  const tv = await tvCtx.newPage();
  tv.on("pageerror", (e) => console.log("TV error:", e.message));
  // Every picture the TV loads, with the stage the game is in at that moment.
  const tvLoads = [];
  tv.on("request", (r) => {
    const hit = motifByStage.get(r.url());
    if (hit) tvLoads.push({ ...hit, gameStage: watch.state?.game?.module?.stage, step: watch.state?.game?.module?.step, index: watch.state?.game?.module?.index });
  });
  await tv.goto(`${WEB}/host/${code}`);
  await tv.getByText("Mitspielen mit dem Code").waitFor();
  // Party asks "alle über 18?" once per room – confirmed here.
  host.send({ type: "update_mode", mode: { mode: MODE, allow16: false, difficulty: "mixed" }, confirmAdult: true });
  check(await waitFor(() => watch.state?.mode?.mode === MODE), `mode ${MODE}`);

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => console.log("phone error:", e.message));
  const phoneLoads = [];
  phone.on("request", (r) => motifByStage.has(r.url()) && phoneLoads.push(r.url()));
  await phone.goto(`${WEB}/join/${code}`);
  await phone.getByPlaceholder("z. B. Toni").fill("Philip");
  await phone.getByRole("button", { name: /Beitreten/ }).click();
  await phone.getByText("Du bist dabei!").waitFor();
  for (let i = 0; i < 2; i++) host.send({ type: "add_bot" });

  check(await waitFor(() => watch.state?.settingsSummary?.categoryIds.join() === "pixelpanik"), `settings: only Pixelpanik (${MODE})`);
  await shot(tv, `${MODE}-0-lobby`);
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.state?.phase === "intro");
  await sleep(1500);
  await shot(tv, `${MODE}-1-intro`);
  host.send({ type: "skip" });
  check(await waitFor(() => watch.state?.phase === "play"), "first picture");

  const mod = () => (watch.state?.phase === "play" ? watch.state.game?.module : null);
  const phoneName = "Philip";
  const meId = () => watch.state?.players.find((p) => p.name === phoneName)?.id;
  let pictures = 0;
  let expectedMine = 0;
  const done = new Set();
  const end = Date.now() + 5 * 60_000;
  while (Date.now() < end && watch.state?.phase === "play") {
    const s = mod();
    if (!s) {
      await sleep(100);
      continue;
    }
    const key = `${s.index}:${s.step}:${s.stage}`;
    if (!done.has(key)) {
      done.add(key);
      if (s.step === "stage" && s.stage === 0) {
        pictures++;
        await sleep(900);
        await shot(tv, `${MODE}-2-pic${s.index + 1}-stage1`);
        await shot(phone, `${MODE}-2-pic${s.index + 1}-phone`);
        // Kids: a wrong option first – greyed out, locked until the next stage (never out).
        const shown = tvLoads.findLast((l) => l.index === s.index);
        if (MODE === "kids" && shown && s.choices) {
          const wrong = s.choices.find((c) => c !== shown.motif.answer);
          await phone.getByRole("button", { name: option(wrong) }).click();
          check(await waitFor(() => mod()?.players.find((p) => p.id === meId())?.status === "locked" || mod()?.stage !== 0, 3_000), `kids: wrong option → locked (picture ${s.index + 1})`);
          await sleep(400);
          await shot(phone, `${MODE}-2-pic${s.index + 1}-phone-wrong`);
          await shot(tv, `${MODE}-2-pic${s.index + 1}-tv-wrong`);
        }
      }
      if (s.step === "stage" && s.stage === 1) {
        // Stage 2 (8×8): the phone answers – the test looks the answer up by the TV's picture.
        await waitFor(() => tvLoads.some((l) => l.index === s.index && l.stage === 1), 3_000);
        const shown = tvLoads.findLast((l) => l.index === s.index);
        const status = s.players.find((p) => p.id === meId())?.status;
        if (shown && status === "open") {
          if (MODE === "kids") {
            await phone.getByRole("button", { name: option(shown.motif.answer) }).click();
          } else {
            await phone.getByLabel("Dein Tipp").fill(shown.motif.synonyms[0] ?? shown.motif.answer);
            await phone.getByRole("button", { name: "Abschicken" }).click();
          }
          expectedMine += 180;
          await sleep(700);
          await shot(phone, `${MODE}-3-pic${s.index + 1}-phone-locked`);
          await shot(tv, `${MODE}-3-pic${s.index + 1}-tv-after-guess`);
        }
      }
      if (s.step === "stage" && s.stage === 5) {
        await sleep(350);
        await shot(tv, `${MODE}-4-pic${s.index + 1}-snap`);
      }
      if (s.step === "reveal") {
        await sleep(900);
        await shot(tv, `${MODE}-5-pic${s.index + 1}-reveal`);
        await shot(phone, `${MODE}-5-pic${s.index + 1}-reveal-phone`);
      }
      if (s.step === "leaderboard" && s.index === 0) {
        await sleep(3000);
        await shot(tv, `${MODE}-6-leaderboard`);
      }
    }
    await sleep(80);
  }

  check(pictures === 5, `5 pictures played (${pictures})`);
  check(await waitFor(() => watch.state?.phase === "scoreboard"), "round over → scoreboard");
  const mine = watch.state?.game?.scores?.[meId()] ?? -1;
  check(mine === expectedMine, `phone's points in the game total: ${mine} (expected ${expectedMine})`);
  await sleep(1500);
  await shot(tv, `${MODE}-7-scoreboard`);

  // Anti-cheat: a picture is loaded only once its stage is showing (or later); the phone loads none.
  const early = tvLoads.filter((l) => l.step === "stage" && l.stage > l.gameStage);
  check(early.length === 0, `TV never loads a later stage early (${tvLoads.length} loads, ${early.length} early)`);
  const fullEarly = tvLoads.filter((l) => l.stage === 5 && l.step === "stage" && l.gameStage < 5);
  check(fullEarly.length === 0, "the full picture is never loaded before stage 6");
  check(phoneLoads.length === 0, `the phone never loads a picture (${phoneLoads.length})`);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
