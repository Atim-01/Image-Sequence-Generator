import assert from "node:assert/strict";
import test from "node:test";
import {
  outputSize,
  parseArgs,
  resolvePlan,
} from "../scripts/extract-frames.js";

test("parseArgs: required shape and shorts", () => {
  const a = parseArgs(["hero.mp4", "-o", "public/seq", "-q", "80", "--frames", "240"]);
  assert.equal(a.positional[0], "hero.mp4");
  assert.equal(a.out, "public/seq");
  assert.equal(a.quality, 80);
  assert.equal(a.frames, 240);
  assert.equal(a.force, false);
});

test("parseArgs: --force and --max-mb", () => {
  const a = parseArgs(["clip.mp4", "--out=out", "--max-mb", "5", "-f"]);
  assert.equal(a.out, "out");
  assert.equal(a.maxMb, 5);
  assert.equal(a.force, true);
});

test("parseArgs: unknown flag", () => {
  assert.throws(() => parseArgs(["--nope"]), /Unknown flag/);
});

const hd = { duration: 4, width: 1920, height: 1080 };
const uhd = { duration: 20, width: 3840, height: 2160 };

test("resolvePlan: short clip uses fps, does not pad to 240", () => {
  const p = resolvePlan({}, hd);
  assert.equal(p.targetCount, 96);
  assert.equal(p.evenSample, false);
  assert.equal(p.capped, false);
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
});

test("resolvePlan: long clip is capped at 240 via even sampling", () => {
  const p = resolvePlan({}, uhd);
  assert.equal(p.targetCount, 240);
  assert.equal(p.capped, true);
  assert.equal(p.evenSample, false);
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.ok(Math.abs(p.extractFps - 12) < 1e-6);
});

test("resolvePlan: --frames ignores cap and samples exactly", () => {
  const p = resolvePlan({ frames: 120 }, { duration: 8, width: 1280, height: 720 });
  assert.equal(p.targetCount, 120);
  assert.equal(p.evenSample, true);
  assert.equal(p.capped, false);
  assert.ok(Math.abs(p.extractFps - 15) < 1e-6);
  assert.equal(p.width, 1280);
  assert.equal(p.height, 720);
});

test("outputSize never upscales", () => {
  assert.deepEqual(outputSize(1280, 720, 1920), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(3840, 2160, 1920), { width: 1920, height: 1080 });
});

test("pad grows with large frame counts", () => {
  const p = resolvePlan({ frames: 10000 }, hd);
  assert.equal(p.pad, 5);
});
