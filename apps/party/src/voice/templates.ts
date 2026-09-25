/**
 * Pre-written lines for when the AI is slow, down, refuses or the room's
 * budget is used up. Shown as subtitles only (no audio).
 */
function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length]!;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}

const WELCOME = [
  (n: string) => `Applaus für ${n}!`,
  (n: string) => `Herzlich willkommen, ${n}!`,
  (n: string) => `Da ist ja ${n} – schön, dass du dabei bist!`,
  (n: string) => `Ein Riesenapplaus für ${n}!`,
];

export function welcomeTemplate(names: readonly string[], random: () => number): string {
  if (names.length > 1) return `… und willkommen ${joinNames(names)}!`;
  return pick(WELCOME, random)(names[0] ?? "");
}

export function startTemplate(playerCount: number): string {
  return playerCount === 1
    ? "Meine Damen und Herren, willkommen bei Couch Clash – heute mit einer einzigen, sehr mutigen Person!"
    : `Meine Damen und Herren, willkommen bei Couch Clash – heute mit ${playerCount} Kandidaten!`;
}

export function commentTemplate(leader: string | null, random: () => number): string {
  if (!leader) return "Was für eine Runde!";
  return pick(
    [`${leader} liegt vorne – spannend!`, `Alle Augen auf ${leader}!`, `Und ${leader} führt!`],
    random,
  );
}

export function finaleTemplate(winners: readonly string[]): string {
  return winners.length > 1
    ? `Applaus! ${joinNames(winners)} gewinnen Couch Clash!`
    : `${winners[0] ?? "Unser Champion"} gewinnt Couch Clash – Applaus!`;
}

/** Round summary without AI, e.g. "Clara bestanden, Max … wir sehen uns nächste Woche wieder." */
export function summaryTemplate(players: readonly { name: string; verdict: string }[]): string {
  const passed = players.filter((p) => p.verdict === "bestanden").map((p) => p.name);
  const failed = players.filter((p) => p.verdict === "durchgefallen").map((p) => p.name);
  if (passed.length === 0 && failed.length === 0) return "Was für eine Runde!";
  if (failed.length === 0) return "Alle bestanden – der TÜV ist stolz auf euch!";
  if (passed.length === 0) return "Durchgefallen – alle! Wir sehen uns nächste Woche wieder.";
  return `${joinNames(passed)} bestanden, ${joinNames(failed)} … wir sehen uns nächste Woche wieder.`;
}
