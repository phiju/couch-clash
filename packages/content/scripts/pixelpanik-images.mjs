#!/usr/bin/env node
/**
 * Pixelpanik: makes the pictures for data/pixelpanik/motive.json ONCE, in
 * advance. Three steps:
 *
 *   1. generate  – fetch every picture, crop it square (subject centred),
 *                  pre-render the six stages and write them into the out dir
 *                  (plus manifest.json and upload.sh). Nothing is uploaded,
 *                  motive.json stays as it is.
 *   2. upload    – run <out-dir>/upload.sh (wrangler → Cloudflare R2).
 *   3. apply     – write the public URLs into motive.json (commit it afterwards).
 *
 *   image_source "ai"        → OpenAI Image API from image_prompt (square)
 *   image_source "svg"       → flag from the npm package flag-icons (1x1)
 *   image_source "wikimedia" → public-domain painting from Wikimedia Commons;
 *                              title, artist, licence and link are kept
 *
 * Stages: 4×4, 8×8, 16×16, 32×32, 64×64 as tiny lossless PNGs (the TV scales
 * them up without smoothing) and the full picture as 1024×1024 WebP. Each
 * file gets its own random name (no motif id, no stage in the name), so the
 * TV – which only ever gets the current stage's URL – can't guess the full
 * picture or the answer.
 *
 * Idempotent: motifs already in the manifest or with `image` in motive.json
 * are skipped (--force redoes them). The manifest is saved after every
 * motif, so an interrupted run just continues. A failed motif (e.g. a
 * rejected prompt) is logged and skipped; the list comes at the end.
 *
 * Usage (from the repo root):
 *   OPENAI_API_KEY=… pnpm --filter @couch-clash/content images:pixelpanik [options]
 *   sh packages/content/.pixelpanik-out/upload.sh
 *   pnpm --filter @couch-clash/content images:pixelpanik --apply --public-base https://pub-….r2.dev
 *
 * Options:
 *   --out-dir <dir>        where the files go (default packages/content/.pixelpanik-out, git-ignored)
 *   --only pp-001,pp-031   only these motifs
 *   --source svg           only one image_source (ai | svg | wikimedia)
 *   --limit 10             at most this many motifs in this run
 *   --force                redo motifs that already have pictures
 *   --preview              also write preview/<id>.png: full picture, 4×4 and 8×8 side by side
 *   --quality medium       OpenAI quality: low | medium | high (default medium)
 *   --apply                step 3: set `image` in motive.json from the manifest (needs --public-base)
 *   --public-base <url>    public URL of the bucket (r2.dev or custom domain)
 *   --bucket <name>        R2 bucket for upload.sh (default couch-clash-pixelpanik)
 *
 * Env: OPENAI_API_KEY (only for "ai" – read from the environment, never
 * logged), PIXELPANIK_IMAGE_MODEL (default "gpt-image-2", like the avatars).
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DATA_FILE = join(here, "..", "data", "pixelpanik", "motive.json");
const DEFAULT_OUT_DIR = join(here, "..", ".pixelpanik-out");

/** Keep in sync with PIXELPANIK_STAGE_SIZES (src/schema.ts). 0 = full picture. */
const STAGE_SIZES = [4, 8, 16, 32, 64, 0];
const FULL_SIZE = 1024;
const USER_AGENT = "CouchClash-Pixelpanik/1.0 (party game; one-time image import)";

const { values: args } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    only: { type: "string" },
    source: { type: "string" },
    limit: { type: "string" },
    force: { type: "boolean", default: false },
    preview: { type: "boolean", default: false },
    quality: { type: "string", default: "medium" },
    apply: { type: "boolean", default: false },
    "public-base": { type: "string" },
    bucket: { type: "string", default: "couch-clash-pixelpanik" },
  },
});

const outDir = resolve(args["out-dir"] ?? DEFAULT_OUT_DIR);
const manifestFile = join(outDir, "manifest.json");
const env = {
  openaiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.PIXELPANIK_IMAGE_MODEL || "gpt-image-2",
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const randomName = (ext) => `${randomBytes(16).toString("base64url")}.${ext}`;

/** Error texts may quote (parts of) a key – never let one reach the log. */
function redact(text) {
  let out = String(text).replace(/\bsk-[A-Za-z0-9_*-]{4,}/g, "sk-***");
  if (env.openaiKey && env.openaiKey.length > 8) out = out.split(env.openaiKey).join("***");
  return out;
}

// ── sources ─────────────────────────────────────────────────────────────

/** OpenAI Image API (square). Waits and retries on rate limits and server errors. */
async function fromOpenAI(item) {
  if (!env.openaiKey) throw new Error('OPENAI_API_KEY missing (needed for image_source "ai")');
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
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 15_000 * attempt;
      console.log(`  OpenAI ${res.status} – waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      // e.g. 400 moderation_blocked: the prompt was rejected.
      const body = await res.text();
      let message = body;
      try {
        const err = JSON.parse(body).error;
        message = [err?.code, err?.message].filter(Boolean).join(": ") || body;
      } catch {
        /* not JSON – keep the text */
      }
      throw new Error(`OpenAI ${res.status}: ${message.slice(0, 300)}`);
    }
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (b64) return { buffer: Buffer.from(b64, "base64") };
    const url = json.data?.[0]?.url;
    if (url) return { buffer: await download(url) };
    throw new Error("OpenAI: no image in the answer");
  }
}

/** flag-icons, 1x1 variant, rendered at full size. */
async function fromFlagIcons(item) {
  if (!item.flag_code) throw new Error("flag_code missing");
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
  let file = item.wikimedia_file ? await commonsFile(item.wikimedia_file) : null;
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

/** Square 1024×1024 (subject centred), transparent parts (e.g. Nepal's flag) on white. */
async function squareOf(buffer) {
  return sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(FULL_SIZE, FULL_SIZE, { fit: "cover", position: "centre" })
    .toBuffer();
}

/** The six stages: N×N PNGs (each block the average colour of its area), then the full picture as WebP. */
async function renderStages(square) {
  const files = [];
  for (const size of STAGE_SIZES) {
    if (size === 0) {
      files.push({ ext: "webp", type: "image/webp", data: await sharp(square).webp({ quality: 86 }).toBuffer() });
    } else {
      files.push({ ext: "png", type: "image/png", data: await sharp(square).resize(size, size, { kernel: "cubic" }).png().toBuffer() });
    }
  }
  return files;
}

/** Preview for the host: full picture, 4×4 and 8×8 (scaled up without smoothing, like the TV). */
async function renderPreview(stageFiles) {
  const tile = 512;
  const gap = 16;
  const upscale = (data) => sharp(data).resize(tile, tile, { kernel: "nearest" }).png().toBuffer();
  const tiles = [
    await sharp(stageFiles[STAGE_SIZES.indexOf(0)].data).resize(tile, tile).png().toBuffer(),
    await upscale(stageFiles[STAGE_SIZES.indexOf(4)].data),
    await upscale(stageFiles[STAGE_SIZES.indexOf(8)].data),
  ];
  return sharp({ create: { width: 3 * tile + 2 * gap, height: tile, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((input, i) => ({ input, left: i * (tile + gap), top: 0 })))
    .png()
    .toBuffer();
}

// ── manifest & upload script ────────────────────────────────────────────

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const TYPES = { png: "image/png", webp: "image/webp" };

/** upload.sh: every file of the manifest into the R2 bucket (re-running it is harmless). */
async function writeUploadScript(manifest) {
  const lines = [
    "#!/bin/sh",
    "# Uploads the Pixelpanik pictures to Cloudflare R2 (needs `npx wrangler login` once).",
    "# Run it from anywhere; re-running is harmless (same names, same files).",
    "set -e",
    'cd "$(dirname "$0")"',
    `BUCKET="\${BUCKET:-${args.bucket}}"`,
    'WRANGLER="${WRANGLER:-npx --yes wrangler@4}"',
  ];
  for (const entry of Object.values(manifest.items)) {
    for (const name of entry.files) {
      const type = TYPES[name.split(".").pop()];
      lines.push(`$WRANGLER r2 object put "$BUCKET/${name}" --file "files/${name}" --content-type ${type} --cache-control "public, max-age=31536000, immutable" --remote`);
    }
  }
  lines.push('echo "Done – now run the --apply step with --public-base."');
  await writeFile(join(outDir, "upload.sh"), `${lines.join("\n")}\n`, { mode: 0o755 });
}

// ── steps ───────────────────────────────────────────────────────────────

async function generate(file, manifest) {
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
  const limit = args.limit ? Number(args.limit) : Infinity;
  const done = (item) => item.image || manifest.items[item.id];
  const todo = file.items.filter(
    (item) => (!only || only.has(item.id)) && (!args.source || item.image_source === args.source) && (args.force || !done(item)),
  );
  const skipped = file.items.filter((item) => done(item) && (!only || only.has(item.id)) && (!args.source || item.image_source === args.source)).length;
  console.log(`${todo.length} motifs to do${Number.isFinite(limit) ? ` (at most ${limit})` : ""}, ${args.force ? 0 : skipped} already done.`);
  await mkdir(join(outDir, "files"), { recursive: true });
  if (args.preview) await mkdir(join(outDir, "preview"), { recursive: true });

  let made = 0;
  const failed = [];
  for (const item of todo.slice(0, limit)) {
    console.log(`${item.id} ${item.answer} (${item.image_source}) …`);
    try {
      const fetched =
        item.image_source === "ai" ? await fromOpenAI(item) : item.image_source === "svg" ? await fromFlagIcons(item) : await fromWikimedia(item);
      const stageFiles = await renderStages(await squareOf(fetched.buffer));
      const names = [];
      for (const f of stageFiles) {
        const name = randomName(f.ext);
        await writeFile(join(outDir, "files", name), f.data);
        names.push(name);
      }
      if (args.preview) await writeFile(join(outDir, "preview", `${item.id}.png`), await renderPreview(stageFiles));
      manifest.items[item.id] = { files: names, ...(fetched.source ? { source: fetched.source } : {}), source_type: item.image_source };
      // Save after every motif: an interrupted run continues where it stopped.
      await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      made++;
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : error);
      console.error(`  ✗ ${message}`);
      failed.push({ id: item.id, answer: item.answer, source: item.image_source, error: message });
    }
  }
  await writeUploadScript(manifest);
  const total = Object.keys(manifest.items).length;
  console.log(`\nDone: ${made} new, ${failed.length} failed, ${total} in the manifest (${relative(process.cwd(), outDir) || "."}).`);
  if (failed.length) {
    console.log("Failed motifs (run again to retry, or fix the prompt):");
    for (const f of failed) console.log(`  ${f.id} ${f.answer} (${f.source}): ${f.error}`);
    process.exitCode = 1;
  }
}

async function apply(file, manifest) {
  const base = args["public-base"]?.replace(/\/+$/, "");
  if (!base || !/^https:\/\//.test(base)) throw new Error("--apply needs --public-base https://… (the bucket's public URL)");
  let set = 0;
  for (const item of file.items) {
    const entry = manifest.items[item.id];
    if (!entry || (item.image && !args.force)) continue;
    item.image = { stages: entry.files.map((name) => `${base}/${name}`), ...(entry.source ? { source: entry.source } : {}) };
    set++;
  }
  await writeFile(DATA_FILE, `${JSON.stringify(file, null, 2)}\n`);
  const missing = file.items.filter((item) => !item.image).map((item) => item.id);
  console.log(`motive.json: ${set} motifs got pictures, ${file.items.length - missing.length}/${file.items.length} have them now.`);
  if (missing.length) console.log(`Still without pictures: ${missing.join(", ")}`);
}

async function main() {
  const file = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const manifest = await readJson(manifestFile, { items: {} });
  if (args.apply) await apply(file, manifest);
  else await generate(file, manifest);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exit(1);
});
