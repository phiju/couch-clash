/**
 * Writes the local test songs (apps/web/public/test-audio/*.wav): short,
 * distinct synth melodies for development and tests (LocalProvider) – no
 * real music, no network. Re-run only when test-songs.json gets a new song.
 *
 *   pnpm --filter @couch-clash/content songs:test-audio
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "../../apps/web/public/test-audio");
const RATE = 8_000;
// As long as a Deezer preview (the buzzer questions run 30 s).
const SECONDS = 30;

/** Semitones above A3 per note; each song its own tune, tempo and timbre. */
const TUNES = {
  "sinus-samba": { bpm: 132, wave: "sine", notes: [3, 7, 10, 7, 12, 10, 7, 3, 5, 8, 12, 8] },
  "dreiklang-disco": { bpm: 124, wave: "square", notes: [0, 4, 7, 12, 7, 4, 0, 4, 2, 5, 9, 5] },
  "quinten-polka": { bpm: 150, wave: "triangle", notes: [0, 7, 0, 7, 5, 12, 5, 12, 4, 11, 4, 11] },
  "oktav-walzer": { bpm: 96, wave: "sine", notes: [0, 12, 12, 2, 14, 14, 4, 16, 16, 2, 14, 14] },
  "tonleiter-twist": { bpm: 140, wave: "square", notes: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5] },
  "bass-boogie": { bpm: 116, wave: "triangle", notes: [-12, -8, -5, -3, -2, -3, -5, -8, -12, -8, -5, -3] },
  "piep-polonaise": { bpm: 104, wave: "square", notes: [7, 7, 9, 7, 12, 11, 7, 7, 9, 7, 14, 12] },
  "summ-schlager": { bpm: 120, wave: "sine", notes: [4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4] },
};

function sample(wave, phase) {
  const x = phase % 1;
  if (wave === "square") return x < 0.5 ? 0.6 : -0.6;
  if (wave === "triangle") return 4 * Math.abs(x - 0.5) - 1;
  return Math.sin(2 * Math.PI * x);
}

function render({ bpm, wave, notes }) {
  const total = RATE * SECONDS;
  const data = Buffer.alloc(total);
  const beat = (60 / bpm) * RATE;
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const n = Math.floor(i / beat);
    const inNote = (i % beat) / beat;
    const freq = 220 * 2 ** (notes[n % notes.length] / 12);
    phase += freq / RATE;
    const env = Math.min(1, inNote * 20) * (1 - inNote * 0.7);
    // Soft fade in/out over the clip so the loop point is gentle.
    const edge = Math.min(1, i / (RATE * 0.3), (total - i) / (RATE * 0.3));
    const kick = n % 2 === 0 && inNote < 0.08 ? Math.sin(2 * Math.PI * 55 * (i % beat) / RATE) * (1 - inNote / 0.08) : 0;
    const v = (sample(wave, phase) * 0.5 * env + kick * 0.4) * edge;
    data[i] = Math.max(0, Math.min(255, Math.round(128 + v * 110)));
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + total, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34); // 8-bit
  header.write("data", 36);
  header.writeUInt32LE(total, 40);
  return Buffer.concat([header, data]);
}

const songs = JSON.parse(readFileSync(join(root, "data/musik/test-songs.json"), "utf8")).items;
mkdirSync(out, { recursive: true });
for (const song of songs) {
  const tune = TUNES[song.providerTrackId];
  if (!tune) throw new Error(`No tune for ${song.providerTrackId}`);
  const file = join(out, `${song.providerTrackId}.wav`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(tune));
  console.log(`✓ ${song.providerTrackId}.wav`);
}
