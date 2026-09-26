/**
 * End-to-end: one Stadt-Land-Fluss letter with TV (1920×1080), one phone and
 * two test bots. The phone fills every field and shouts "Stopp!" – the TV
 * and the phone show the same, shorter end. Then check, reveal (every
 * answer on the TV), vote and the points in the game total.
 * Needs `pnpm dev:party` and `pnpm dev:web`.
 *   MODE=family|party|kids SHOTS=./shots pnpm --filter @couch-clash/web e2e:stadt-land-fluss
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PARTY = process.env.PARTY ?? "127.0.0.1:1999";
const WEB = process.env.WEB ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS ?? null;
const MODE = process.env.MODE ?? "family";
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

const IDS = ["quiz", "estimate", "category-pick", "double-or-nothing", "bet", "steal", "fuehrerschein", "pixelpanik", "bluff", "skurril", "stadt-land-fluss", "survival"];
const SETUP = {
  order: IDS,
  choices: Object.fromEntries(IDS.map((id) => [id, { enabled: id === "stadt-land-fluss", questionCount: 1 }])),
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
  tv.on("console", (m) => m.type() === "error" && console.log("TV console:", m.text().slice(0, 300)));
  await tv.goto(`${WEB}/host/${code}`);
  await tv.getByText("Mitspielen mit dem Code").waitFor();
  host.send({ type: "update_mode", mode: { mode: MODE, allow16: false, difficulty: "mixed" }, confirmAdult: true });
  check(await waitFor(() => watch.state?.mode?.mode === MODE), `mode ${MODE}`);

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => console.log("phone error:", e.message));
  phone.on("console", (m) => m.type() === "error" && console.log("phone console:", m.text().slice(0, 300)));
  await phone.goto(`${WEB}/join/${code}`);
  await phone.getByPlaceholder("z. B. Toni").fill("Philip");
  await phone.getByRole("button", { name: /Beitreten/ }).click();
  await phone.getByText("Du bist dabei!").waitFor();
  for (let i = 0; i < 2; i++) host.send({ type: "add_bot" });

  check(await waitFor(() => watch.state?.settingsSummary?.categoryIds.join() === "stadt-land-fluss"), `settings: only Stadt, Land, Fluss (${MODE})`);
  await shot(tv, `${MODE}-0-lobby`);
  await tv.getByRole("button", { name: "Spiel starten" }).click();
  await waitFor(() => watch.state?.phase === "intro");
  await sleep(1500);
  await shot(tv, `${MODE}-1-intro`);
  host.send({ type: "skip" });
  const mod = () => (watch.state?.phase === "play" ? watch.state.game?.module : null);
  check(await waitFor(() => mod()?.step === "intro"), "letter intro");
  await sleep(1200);
  await shot(tv, `${MODE}-2-letter`);
  await shot(phone, `${MODE}-2-letter-phone`);
  check(await waitFor(() => mod()?.step === "write", 10_000), "writing");
  const s = mod();
  const L = s.letter;
  const cats = s.categories;
  check(MODE !== "kids" || !"CQXY".includes(L), `kids letter ${L}`);
  if (MODE === "party") check(cats.filter((c) => c.id.startsWith("p-")).length >= 2, "party: ≥ 2 party categories");
  else check(cats.every((c) => !c.id.startsWith("p-")), "no party categories");

  await sleep(800);
  await shot(tv, `${MODE}-3-write`);
  const words = { A: "Anton", B: "Berlin", D: "Duschkopf" };
  for (const [i, c] of cats.entries()) await phone.getByLabel(c.label).fill(i === 0 ? `${words[L] ?? L + "urmel"}` : `${L}utzi ${i}`);
  await sleep(900);
  await shot(phone, `${MODE}-3-write-phone`);
  const before = mod().stepEndsAt;
  await phone.getByRole("button", { name: /Stopp!/ }).click();
  check(await waitFor(() => !!mod()?.stop, 3_000), "Stopp! arrived");
  const after = mod().stepEndsAt;
  check(after < before && Math.abs(after - mod().stop.at - mod().stopSeconds * 1000) < 5, `10 s for everyone else (${Math.round((after - mod().stop.at) / 1000)} s)`);
  await sleep(700);
  await shot(tv, `${MODE}-4-stop`);
  await shot(phone, `${MODE}-4-stop-phone`);

  check(await waitFor(() => mod()?.step === "check" || mod()?.step === "script" || mod()?.step === "reveal", 15_000), "check");
  await sleep(300);
  await shot(tv, `${MODE}-5-check`);
  check(await waitFor(() => mod()?.step === "reveal", 25_000), "reveal");
  const reveal = mod().reveal;
  console.log(`AI check: ${reveal.aiChecked}`);
  for (const c of reveal.categories) console.log(`  🎙️ ${c.script}`);
  const names = watch.state.players.map((p) => p.name);
  check(reveal.categories.every((c) => names.every((n) => c.script.includes(n))), "every player is named in every category");
  await sleep(1500);
  await shot(tv, `${MODE}-6-reveal-1`);
  await shot(phone, `${MODE}-6-reveal-phone`);
  if (reveal.categories.length > 1) {
    await waitFor(() => Date.now() + (watch.state?.clockOffset ?? 0) > mod().stepStartedAt + reveal.categories[1].startsAtMs + 1500, 30_000);
    await shot(tv, `${MODE}-6-reveal-2`);
  }
  host.send({ type: "skip" });
  check(await waitFor(() => mod()?.step === "vote" || mod()?.step === "tally", 10_000), "vote or tally");
  if (mod()?.step === "vote") {
    await sleep(800);
    await shot(tv, `${MODE}-7-vote`);
    await shot(phone, `${MODE}-7-vote-phone`);
    const pick = phone.locator("button:not([disabled])").filter({ hasNotText: "Stopp" }).first();
    if (await pick.count()) await pick.click();
  }
  check(await waitFor(() => mod()?.step === "tally", 30_000), "tally");
  await sleep(1200);
  await shot(tv, `${MODE}-8-tally`);
  await shot(phone, `${MODE}-8-tally-phone`);
  const meId = watch.state.players.find((p) => p.name === "Philip")?.id;
  const expected = mod().tally.points[meId]?.total ?? 0;
  check(await waitFor(() => mod()?.step === "leaderboard", 15_000), "leaderboard");
  check((watch.state.game.scores?.[meId] ?? 0) === expected, `phone's points in the game total: ${watch.state.game.scores?.[meId]} (expected ${expected})`);
  await sleep(2500);
  await shot(tv, `${MODE}-9-leaderboard`);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
