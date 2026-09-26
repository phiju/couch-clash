#!/usr/bin/env node
/**
 * Pixelpanik: fetches the pictures for data/pixelpanik/motive.json ONCE, in
 * advance, and writes their URLs back into the file.
 *
 *   image_source "ai"        → OpenAI Image API from image_prompt (square)
 *   image_source "svg"       → flag from the npm package flag-icons (1x1), rendered to PNG
 *   image_source "wikimedia" → public-domain painting from Wikimedia Commons,
 *                              cropped square (subject centred), source noted
 *
 * Every picture is then pre-rendered into the six stages (4×4, 8×8, 16×16,
 * 32×32, 64×64 pixels and the full 1024×1024 picture) and uploaded to
 * Supabase Storage. Each file gets its own random name (no motif id, no
 * stage in the name), so the TV – which only ever gets the current stage's
 * URL – can't guess the full picture or the answer.
 *
 * Idempotent: motifs that already have `image` are skipped (--force redoes
 * them). The file is saved after every motif, so an interrupted run just
 * continues next time.
 *
 * Usage (from the repo root):
 *   SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=… OPENAI_API_KEY=… \
 *     pnpm --filter @couch-clash/content images:pixelpanik [options]
 *
 * Options:
 *   --only pp-001,pp-031   only these motifs
 *   --source svg           only one image_source (ai | svg | wikimedia)
 *   --limit 10             at most this many motifs in this run
 *   --force                redo motifs that already have pictures
 *   --out-dir ./tmp/pp     dry run: write the files there, upload nothing, keep motive.json as it is
 *   --quality medium       OpenAI quality: low | medium | high (default medium)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET (default
 * "pixelpanik", created public if missing), OPENAI_API_KEY (only for "ai"),
 * PIXELPANIK_IMAGE_MODEL (default "gpt-image-2", like the avatars).
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DATA_FILE = join(here, "..", "data", "pixelpanik", "motive.json");

/** Keep in sync with PIXELPANIK_STAGE_SIZES (src/schema.ts). 0 = full picture. */
const STAGE_SIZES = [4, 8, 16, 32, 64, 0];
const FULL_SIZE = 1024;
const USER_AGENT = "CouchClash-Pixelpanik/1.0 (party game; one-time image import)";

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    source: { type: "string" },
    limit: { type: "string" },
    force: { type: "boolean", default: false },
    "out-dir": { type: "string" },
    quality: { type: "string", default: "medium" },
  },
});

const dryRun = args["out-dir"] !== undefined;
const env = {
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/+$/, ""),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_BUCKET || "pixelpanik",
  openaiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.PIXELPANIK_IMAGE_MODEL || "gpt-image-2",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomName = (ext) => `${randomBytes(16).toString("base64url")}.${ext}`;

// ── sources ─────────────────────────────────────────────────────────────

/** OpenAI Image API (square). Waits and retries on rate limits. */
async function fromOpenAI(item) {
  if (!env.openaiKey) throw new Error("OPENAI_API_KEY missing (needed for image_source \"ai\")");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.imageModel,
        prompt: `${item.image_prompt}. Square composition, the subject large and clearly recognizable in the middle.`,
        size: "1024x1024",
        quality: args.quality,
        n: 1,
      }),
    });
    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 15_000;
      console.log(`  rate limit – waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (b64) return { buffer: Buffer.from(b64, "base64") };
    const url = json.data?.[0]?.url;
    if (url) return { buffer: await download(url) };
    throw new Error("OpenAI: no image in the answer");
  }
}

/** flag-icons, 1x1 variant, rendered to PNG. */
async function fromFlagIcons(item) {
  const file = require.resolve(`flag-icons/flags/1x1/${item.flag_code}.svg`);
  const svg = await readFile(file);
  // A high density keeps thin lines and emblems crisp.
  return { buffer: await sharp(svg, { density: 600 }).resize(FULL_SIZE, FULL_SIZE).png().toBuffer() };
}

async function commonsApi(params) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikimedia API ${res.status}`);
  return res.json();
}

const stripHtml = (html) => (html ? String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : undefined);

async function commonsFile(title) {
  const json = await commonsApi({
    action: "query",
    titles: title.startsWith("File:") ? title : `File:${title}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "2000",
  });
  const page = json.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info) return null;
  const meta = info.extmetadata ?? {};
  return {
    download: info.thumburl || info.url,
    source: {
      url: info.descriptionurl,
      title: stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      author: stripHtml(meta.Artist?.value),
      license: stripHtml(meta.LicenseShortName?.value) || "Public domain",
    },
  };
}

/** Public-domain painting from Wikimedia Commons: the named file, else the best search hit. */
async function fromWikimedia(item) {
  let file = await commonsFile(item.wikimedia_file);
  if (!file) {
    // "Public-domain reproduction of The Starry Night by Vincent van Gogh (…)" → "The Starry Night Vincent van Gogh"
    const query = item.image_prompt.replace(/^Public-domain reproduction of\s*/i, "").replace(/\(.*\)/, "").replace(/\bby\b/, "").trim();
    const hits = await commonsApi({ action: "query", list: "search", srnamespace: "6", srlimit: "5", srsearch: `${query} filetype:bitmap` });
    for (const hit of hits.query?.search ?? []) {
      file = await commonsFile(hit.title);
      if (file) {
        console.log(`  ${item.wikimedia_file} not found – using ${hit.title}`);
        break;
      }
    }
  }
  if (!file) throw new Error(`Wikimedia: nothing found for ${item.wikimedia_file}`);
  return { buffer: await download(file.download), source: file.source };
}

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── rendering ───────────────────────────────────────────────────────────

/**
 * Square (subject centred) → the six stages. Stages 1–5 are tiny N×N PNGs
 * (the TV scales them up without smoothing); stage 6 is the full picture.
 */
async function renderStages(buffer) {
  // Transparent parts (e.g. Nepal's flag) on white – the same in every stage.
  const square = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(FULL_SIZE, FULL_SIZE, { fit: "cover", position: "centre" })
    .toBuffer();
  const files = [];
  for (const size of STAGE_SIZES) {
    if (size === 0) {
      files.push({ ext: "webp", type: "image/webp", data: await sharp(square).webp({ quality: 86 }).toBuffer() });
    } else {
      // Each block is the average colour of its area.
      const data = await sharp(square).resize(size, size, { kernel: "cubic" }).png().toBuffer();
      files.push({ ext: "png", type: "image/png", data });
    }
  }
  return files;
}

// ── storage ─────────────────────────────────────────────────────────────

async function ensureBucket() {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.supabaseKey}`, apikey: env.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ id: env.bucket, name: env.bucket, public: true }),
  });
  if (res.ok) console.log(`Bucket "${env.bucket}" created (public).`);
  else if (res.status !== 409 && !/already exists|Duplicate/i.test(await res.text())) {
    throw new Error(`Supabase: bucket "${env.bucket}" could not be created (${res.status})`);
  }
}

async function upload(file) {
  const path = randomName(file.ext);
  if (dryRun) {
    const out = join(args["out-dir"], path);
    await writeFile(out, file.data);
    return out;
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${env.supabaseUrl}/storage/v1/object/${env.bucket}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.supabaseKey}`,
        apikey: env.supabaseKey,
        "Content-Type": file.type,
        "Cache-Control": "max-age=31536000",
        "x-upsert": "false",
      },
      body: file.data,
    });
    if (res.ok) return `${env.supabaseUrl}/storage/v1/object/public/${env.bucket}/${path}`;
    if (attempt >= 3) throw new Error(`Supabase upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sleep(2_000 * attempt);
  }
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  if (!dryRun && (!env.supabaseUrl || !env.supabaseKey)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (or --out-dir for a dry run)");
  }
  const file = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
  const limit = args.limit ? Number(args.limit) : Infinity;
  const todo = file.items.filter(
    (item) =>
      (!only || only.has(item.id)) &&
      (!args.source || item.image_source === args.source) &&
      (args.force || !item.image),
  );
  const skipped = file.items.filter((item) => item.image && (!only || only.has(item.id))).length;
  console.log(`${todo.length} motifs to do${Number.isFinite(limit) ? ` (at most ${limit})` : ""}, ${args.force ? 0 : skipped} already have pictures.`);
  if (dryRun) await mkdir(args["out-dir"], { recursive: true });
  else if (todo.length) await ensureBucket();

  let done = 0;
  const failed = [];
  for (const item of todo.slice(0, limit)) {
    console.log(`${item.id} ${item.answer} (${item.image_source}) …`);
    try {
      const fetched =
        item.image_source === "ai" ? await fromOpenAI(item) : item.image_source === "svg" ? await fromFlagIcons(item) : await fromWikimedia(item);
      const stages = [];
      for (const stageFile of await renderStages(fetched.buffer)) stages.push(await upload(stageFile));
      if (dryRun) {
        console.log(`  → ${stages.join("\n    ")}`);
      } else {
        item.image = { stages, ...(fetched.source ? { source: fetched.source } : {}) };
        // Save after every motif: an interrupted run continues where it stopped.
        await writeFile(DATA_FILE, `${JSON.stringify(file, null, 2)}\n`);
      }
      done++;
    } catch (error) {
      console.error(`  ✗ ${error instanceof Error ? error.message : error}`);
      failed.push(item.id);
    }
  }
  console.log(`\nDone: ${done} new, ${failed.length} failed${failed.length ? ` (${failed.join(", ")} – run again to retry)` : ""}.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
