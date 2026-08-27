#!/usr/bin/env node
/**
 * Extract a GSAP-ready WebP sequence from a single video.
 *
 * Defaults (agency / scroll-scrub):
 *   --fps 24, cap 240, max-width 1920, quality 75
 *   --frames N        exact count (even sampling); ignores the cap
 *   --max-mb          opt-in budget; lowers quality down to --min-quality, then fails
 *   -o                required; refuse a dirty folder unless --force
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULTS = {
  fps: 24,
  cap: 240,
  maxWidth: 1920,
  quality: 75,
  minQuality: 50,
  prefix: "frame_",
  startNumber: 1,
  compressionLevel: 6,
  probeFrames: 10,
  qualityStep: 5,
};

const KEEP_IN_OUT = new Set([".gitkeep", ".gitignore"]);

const tty = Boolean(process.stdout.isTTY);
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);
const green = (s) => paint("32", s);
const yellow = (s) => paint("33", s);
const red = (s) => paint("31", s);

export function parseArgs(argv) {
  const flags = {
    frames: { type: "number" },
    fps: { type: "number" },
    cap: { type: "number" },
    "max-width": { type: "number", key: "maxWidth" },
    quality: { type: "number" },
    "max-mb": { type: "number", key: "maxMb" },
    "min-quality": { type: "number", key: "minQuality" },
    prefix: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean" },
    help: { type: "boolean" },
  };
  const shorts = {
    o: "out",
    f: "force",
    h: "help",
    q: "quality",
  };

  const out = { positional: [], force: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith("-") || token === "-") {
      out.positional.push(token);
      continue;
    }

    let name;
    let inline;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      inline = eq === -1 ? undefined : token.slice(eq + 1);
    } else {
      const letters = token.slice(1);
      if (letters.length > 1 && !shorts[letters[0]]) {
        throw userError(`Unknown flag: ${token}`);
      }
      if (letters.length > 1 && shorts[letters[0]] && flags[shorts[letters[0]]]?.type === "boolean") {
        for (const letter of letters) {
          const long = shorts[letter];
          if (!long || flags[long]?.type !== "boolean") {
            throw userError(`Unknown flag: -${letter}`);
          }
          out[flags[long].key ?? long] = true;
        }
        continue;
      }
      name = shorts[letters] ?? shorts[letters[0]];
      if (!name) throw userError(`Unknown flag: ${token}`);
    }

    const spec = flags[name];
    if (!spec) throw userError(`Unknown flag: --${name}`);
    const key = spec.key ?? name;

    if (spec.type === "boolean") {
      if (inline !== undefined && inline !== "true" && inline !== "false") {
        throw userError(`--${name} does not take a value`);
      }
      out[key] = inline === "false" ? false : true;
      continue;
    }

    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined || value.startsWith("-")) {
      throw userError(`--${name} requires a value`);
    }

    if (spec.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw userError(`--${name} must be a number`);
      out[key] = n;
    } else {
      out[key] = value;
    }
  }

  return out;
}

export function usage() {
  return `
${bold("extract-frames")} — MP4 to GSAP-ready WebP sequence

${dim("Usage:")}
  node scripts/extract-frames.js <video> -o <folder> [options]
  npm run sequence -- source/hero.mp4 -o public/hero-sequence

${dim("Required:")}
  <video>                 Input file (mp4, mov, webm, …)
  -o, --out <folder>      Output directory (created if missing)

${dim("Frame count")} ${dim("(ScrollTrigger cares about this, not playback fps)")}
  --frames <n>            Exact frame count, evenly sampled (ignores --cap)
  --fps <n>               Fallback rate when --frames is omitted  ${dim("[24]")}
  --cap <n>               Max frames in fps mode  ${dim("[240]")}

${dim("Image")}
  --max-width <px>        Downscale cap, never upscales  ${dim("[1920]")}
  -q, --quality <0-100>   WebP quality  ${dim("[75]")}
  --prefix <name>         Filename prefix  ${dim("[frame_]")}

${dim("Budget")} ${dim("(opt-in)")}
  --max-mb <n>            Target folder size; may lower quality to fit
  --min-quality <0-100>   Quality floor for --max-mb  ${dim("[50]")}

${dim("Other")}
  -f, --force             Replace existing frames in the output folder
  -h, --help              Show this help
`.trim();
}

export function resolvePlan(raw, meta) {
  const fps = raw.fps ?? DEFAULTS.fps;
  const cap = raw.cap ?? DEFAULTS.cap;
  const maxWidth = raw.maxWidth ?? DEFAULTS.maxWidth;
  const quality = raw.quality ?? DEFAULTS.quality;
  const minQuality = raw.minQuality ?? DEFAULTS.minQuality;
  const prefix = raw.prefix ?? DEFAULTS.prefix;

  if (fps <= 0) throw userError("--fps must be > 0");
  if (cap <= 0) throw userError("--cap must be > 0");
  if (maxWidth < 2) throw userError("--max-width must be >= 2");
  if (quality < 0 || quality > 100) throw userError("--quality must be 0–100");
  if (minQuality < 0 || minQuality > 100) throw userError("--min-quality must be 0–100");
  if (raw.frames !== undefined && (!Number.isInteger(raw.frames) || raw.frames < 1)) {
    throw userError("--frames must be an integer >= 1");
  }
  if (raw.maxMb !== undefined && raw.maxMb <= 0) {
    throw userError("--max-mb must be > 0");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
    throw userError("--prefix may only contain letters, numbers, _ and -");
  }

  const evenSample = raw.frames !== undefined;
  const uncapped = evenSample
    ? raw.frames
    : Math.max(1, Math.round(meta.duration * fps));
  const targetCount = evenSample ? raw.frames : Math.min(uncapped, cap);
  const capped = !evenSample && uncapped > cap;
  const extractFps = targetCount / meta.duration;
  const pad = Math.max(4, String(targetCount + DEFAULTS.startNumber - 1).length);
  const { width, height } = outputSize(meta.width, meta.height, maxWidth);

  return {
    evenSample,
    capped,
    targetCount,
    extractFps,
    fps,
    cap,
    maxWidth,
    width,
    height,
    quality,
    minQuality,
    maxMb: raw.maxMb,
    prefix,
    pad,
    startNumber: DEFAULTS.startNumber,
    compressionLevel: DEFAULTS.compressionLevel,
  };
}

export function outputSize(srcW, srcH, maxWidth) {
  const width = Math.min(srcW, maxWidth);
  const height = evenInt(Math.round((srcH * width) / srcW) || 2);
  return { width, height };
}

function evenInt(n) {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v - 1;
}

function userError(message) {
  const err = new Error(message);
  err.user = true;
  return err;
}

function mb(bytes) {
  return bytes / 1e6;
}

function fmtMb(bytes) {
  return `${mb(bytes).toFixed(2)} MB`;
}

function fmtDuration(seconds) {
  return `${seconds.toFixed(2)}s`;
}

function parseRatio(value) {
  if (!value || value === "N/A") return null;
  if (value.includes("/")) {
    const [a, b] = value.split("/").map(Number);
    if (b) return a / b;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function vf({ extractFps, maxWidth }) {
  // Comma inside min() must be escaped so it is not a filter separator.
  return `fps=${extractFps.toFixed(6)},scale=w=min(${maxWidth}\\,iw):h=-2:flags=lanczos`;
}

function patternName(prefix, pad, index) {
  return `${prefix}${String(index).padStart(pad, "0")}.webp`;
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, { onStdoutLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    let lineBuf = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!onStdoutLine) return;
      lineBuf += text;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? "";
      for (const line of lines) onStdoutLine(line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      if (err.code === "ENOENT") {
        reject(
          userError(
            `${cmd} was not found on PATH. Install FFmpeg and restart the terminal.\n` +
              "  Windows:  winget install Gyan.FFmpeg\n" +
              "  macOS:    brew install ffmpeg\n" +
              "  Linux:    sudo apt install ffmpeg"
          )
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(userError("Cancelled."));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `${cmd} exited with code ${code}`;
      reject(new Error(detail));
    });
  });
}

async function ensureTools() {
  await run("ffprobe", ["-version"]);
  const { stdout, stderr } = await run("ffmpeg", ["-hide_banner", "-encoders"]);
  const list = `${stdout}\n${stderr}`;
  if (!/^\s*V\S*\s+libwebp\b/m.test(list)) {
    throw userError(
      "This FFmpeg build has no libwebp encoder. Install a full build (e.g. Gyan.FFmpeg), not a slim binary."
    );
  }
}

async function probeVideo(input) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-select_streams",
    "v:0",
    input,
  ]);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw userError("ffprobe returned invalid JSON. Is the file a valid video?");
  }

  const stream = data.streams?.[0];
  if (!stream) throw userError("No video stream found in the input file.");

  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!width || !height) throw userError("Could not read video width/height.");

  const duration =
    parseFloat(data.format?.duration) ||
    parseFloat(stream.duration) ||
    (() => {
      const frames = parseInt(stream.nb_frames, 10);
      const rate = parseRatio(stream.avg_frame_rate) || parseRatio(stream.r_frame_rate);
      return frames && rate ? frames / rate : NaN;
    })();

  if (!Number.isFinite(duration) || duration <= 0) {
    throw userError("Could not determine video duration.");
  }

  const sourceFps =
    parseRatio(stream.avg_frame_rate) || parseRatio(stream.r_frame_rate);

  return {
    width,
    height,
    duration,
    sourceFps,
    codec: stream.codec_name ?? "unknown",
  };
}

function renderBar(current, total) {
  const pct = total <= 0 ? 1 : Math.min(1, current / total);
  const width = 28;
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const label = `${Math.round(pct * 100).toString().padStart(3, " ")}%`;
  const counts = `${Math.min(current, total)}/${total}`;
  return `  ${bar} ${label}  ${counts}`;
}

async function ffmpegExtract({
  input,
  destPattern,
  plan,
  quality,
  expected,
  label,
  signal,
}) {
  const args = [
    "-y",
    "-i",
    input,
    "-vf",
    vf(plan),
    "-an",
    "-c:v",
    "libwebp",
    "-quality",
    String(quality),
    "-compression_level",
    String(plan.compressionLevel),
    "-preset",
    "photo",
    "-start_number",
    String(plan.startNumber),
    destPattern,
  ];

  let last = 0;
  const draw = (frame) => {
    last = frame;
    if (!tty) return;
    process.stdout.write(`\r${renderBar(frame, expected)}`);
  };

  if (label) console.log(label);

  let ok = false;
  try {
    await run(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1", ...args],
      {
        signal,
        onStdoutLine: (line) => {
          if (line.startsWith("frame=")) {
            const n = parseInt(line.slice(6), 10);
            if (Number.isFinite(n)) draw(n);
          }
        },
      }
    );
    ok = true;
  } finally {
    if (tty) {
      process.stdout.write(`\r${renderBar(ok ? expected : last, expected)}\n`);
    } else if (last) {
      console.log(`  ${last}/${expected} frames`);
    }
  }
}

async function listFrameFiles(dir, prefix) {
  const names = await readdir(dir);
  return names
    .filter((n) => n.startsWith(prefix) && n.endsWith(".webp"))
    .sort();
}

async function folderBytes(dir, names) {
  let total = 0;
  for (const name of names) {
    total += (await stat(path.join(dir, name))).size;
  }
  return total;
}

async function assertOutputDir(outDir, { force, prefix }) {
  await mkdir(outDir, { recursive: true });
  const entries = (await readdir(outDir)).filter((n) => !KEEP_IN_OUT.has(n));
  if (entries.length === 0) return;

  if (!force) {
    throw userError(
      `Output folder is not empty: ${outDir}\n` +
        "  Re-run with --force to replace existing frames in this folder."
    );
  }

  for (const name of entries) {
    const ours = name === "manifest.json" || (name.startsWith(prefix) && name.endsWith(".webp"));
    if (!ours) {
      throw userError(
        `Output folder has files this tool will not delete (${name}).\n` +
          "  Use a dedicated sequence folder, or move those files out first."
      );
    }
    await rm(path.join(outDir, name), { force: true });
  }
}

async function withTempDir(fn) {
  const dir = path.join(
    os.tmpdir(),
    `isg-probe-${process.pid}-${Date.now()}`
  );
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function probeAverageBytes(input, plan, quality, signal) {
  const count = Math.min(DEFAULTS.probeFrames, plan.targetCount);
  // Same timeline as the full extract, fewer samples: fps = count / duration.
  const probePlan = {
    ...plan,
    extractFps: (count * plan.extractFps) / plan.targetCount,
  };

  return withTempDir(async (dir) => {
    const dest = path.join(dir, "p_%02d.webp");
    // start_number 1 → p_01.webp; listFrameFiles uses prefix "p_".
    await ffmpegExtract({
      input,
      destPattern: dest,
      plan: probePlan,
      quality,
      expected: count,
      label: `  Sampling ${count} frames at q=${quality}…`,
      signal,
    });
    const files = await listFrameFiles(dir, "p_");
    if (files.length === 0) {
      throw new Error("Quality probe produced no frames.");
    }
    const bytes = await folderBytes(dir, files);
    return bytes / files.length;
  });
}

async function chooseQuality(input, plan, signal) {
  if (plan.maxMb === undefined) {
    return { quality: plan.quality, projectedBytes: null, lowered: false };
  }

  const budget = plan.maxMb * 1e6;
  let quality = plan.quality;
  let projectedBytes = 0;
  let lowered = false;

  console.log(`\n${bold("  Budget check")}`);

  while (true) {
    const avg = await probeAverageBytes(input, plan, quality, signal);
    projectedBytes = avg * plan.targetCount;
    const line = `  q=${quality}  projected ${fmtMb(projectedBytes)}  budget ${plan.maxMb.toFixed(2)} MB`;

    if (projectedBytes <= budget) {
      console.log(green(`${line}  OK`));
      return { quality, projectedBytes, lowered };
    }

    console.log(yellow(`${line}  over`));
    if (quality <= plan.minQuality) break;
    quality = Math.max(plan.minQuality, quality - DEFAULTS.qualityStep);
    lowered = true;
    console.log(dim(`  Lowering quality → ${quality}`));
  }

  throw userError(
    `Projected ${fmtMb(projectedBytes)} exceeds --max-mb ${plan.maxMb} even at q=${plan.minQuality}.\n` +
      "  Raise the budget, or reduce payload with --frames / --max-width."
  );
}

function printPlan(input, outDir, meta, plan) {
  const srcFps = meta.sourceFps ? meta.sourceFps.toFixed(2) : "?";
  const mode = plan.evenSample
    ? `exact --frames ${plan.targetCount}`
    : plan.capped
      ? `--fps ${plan.fps} capped at ${plan.cap}`
      : `--fps ${plan.fps}`;

  console.log(`
${bold("Image sequence")}
  ${dim("Source")}     ${input}
  ${dim("           ")} ${meta.width}×${meta.height}  ${fmtDuration(meta.duration)}  ${srcFps} fps  ${meta.codec}
  ${dim("Output")}     ${outDir}
  ${dim("Frames")}     ${plan.targetCount}  ${dim(`(${mode})`)}
  ${dim("Size")}       ${plan.width}×${plan.height}${plan.width < meta.width ? dim("  downscaled") : dim("  native")}
  ${dim("Quality")}    ${plan.quality}${plan.maxMb ? dim(`  budget ${plan.maxMb} MB`) : ""}
`.trimEnd());
}

async function writeManifest(outDir, payload) {
  const dest = path.join(outDir, "manifest.json");
  await writeFile(dest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return dest;
}

export async function main(argv = process.argv.slice(2)) {
  const raw = parseArgs(argv);
  if (raw.help) {
    console.log(usage());
    return 0;
  }

  const input = raw.positional[0];
  if (!input) {
    console.log(usage());
    return 1;
  }
  if (raw.positional.length > 1) {
    throw userError(`Unexpected extra argument: ${raw.positional[1]}`);
  }
  if (!raw.out) {
    throw userError("Output folder is required. Example: -o public/hero-sequence");
  }

  const inputPath = path.resolve(input);
  const outDir = path.resolve(raw.out);

  if (!(await pathExists(inputPath))) {
    throw userError(`Input file not found: ${inputPath}`);
  }

  const ac = new AbortController();
  const onSig = () => ac.abort();
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    await ensureTools();
    const meta = await probeVideo(inputPath);
    const plan = resolvePlan(raw, meta);

    printPlan(inputPath, outDir, meta, plan);
    await assertOutputDir(outDir, { force: Boolean(raw.force), prefix: plan.prefix });

    const chosen = await chooseQuality(inputPath, plan, ac.signal);
    const quality = chosen.quality;

    if (chosen.lowered) {
      console.log(yellow(`  Using quality ${quality} (requested ${plan.quality})`));
    }

    console.log(bold("\n  Extracting"));
    const destPattern = path.join(
      outDir,
      `${plan.prefix}%0${plan.pad}d.webp`
    );
    await ffmpegExtract({
      input: inputPath,
      destPattern,
      plan,
      quality,
      expected: plan.targetCount,
      signal: ac.signal,
    });

    const files = await listFrameFiles(outDir, plan.prefix);
    if (files.length === 0) {
      throw new Error("FFmpeg finished but no .webp frames were written.");
    }

    const bytes = await folderBytes(outDir, files);
    const totalFrames = files.length;
    const firstIndex = plan.startNumber;
    const lastIndex = plan.startNumber + totalFrames - 1;

    const manifest = {
      total_frames: totalFrames,
      start_number: plan.startNumber,
      pad: plan.pad,
      prefix: plan.prefix,
      extension: "webp",
      pattern: `${plan.prefix}%0${plan.pad}d.webp`,
      first_frame: patternName(plan.prefix, plan.pad, firstIndex),
      last_frame: patternName(plan.prefix, plan.pad, lastIndex),
      format: "webp",
      width: plan.width,
      height: plan.height,
      quality,
      quality_requested: plan.quality,
      fps: Number(plan.extractFps.toFixed(6)),
      folder_size_mb: Number(mb(bytes).toFixed(2)),
      source: path.basename(inputPath),
      max_mb: plan.maxMb ?? null,
    };

    const manifestPath = await writeManifest(outDir, manifest);

    if (totalFrames !== plan.targetCount) {
      console.log(
        yellow(
          `  Note: asked for ${plan.targetCount} frames, FFmpeg wrote ${totalFrames}. Manifest uses the real count.`
        )
      );
    }

    if (plan.maxMb !== undefined && bytes > plan.maxMb * 1e6) {
      console.log(
        yellow(
          `  Warning: final size ${fmtMb(bytes)} is over the ${plan.maxMb} MB budget (probe is an estimate).`
        )
      );
    }

    console.log(`
${green("  Done")}
  ${totalFrames} frames  ${fmtMb(bytes)}  q=${quality}
  ${dim(manifestPath)}
`);
    return 0;
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => {
      const msg = err?.user ? err.message : err?.stack || String(err);
      console.error(`\n${red("Error")}  ${msg}\n`);
      process.exit(err?.user ? 1 : 2);
    }
  );
}
