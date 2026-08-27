import assert from "node:assert/strict";
import test from "node:test";
import {
  basename,
  exportFrameName,
  inferManifest,
  shouldSkipPath,
} from "../public/js/infer-manifest.js";
import { buildIndexHtml, escapeHtml } from "../public/js/export-site.js";
import { zipSync, unzipSync, strFromU8, strToU8 } from "../public/vendor/fflate.js";

test("basename flattens nested zip paths", () => {
  assert.equal(basename("clip_frames/frame_0001.webp"), "frame_0001.webp");
  assert.equal(basename("C:\\\\temp\\\\a.png"), "a.png");
});

test("skips junk from macOS / Windows zips", () => {
  assert.equal(shouldSkipPath("__MACOSX/._frame_0001.webp"), true);
  assert.equal(shouldSkipPath(".DS_Store"), true);
  assert.equal(shouldSkipPath("frame_0001.webp"), false);
});

test("inferManifest sorts numbered frames and normalizes names", () => {
  const m = inferManifest([
    "out/frame_10.webp",
    "out/frame_2.webp",
    "out/frame_1.webp",
  ]);
  assert.equal(m.total_frames, 3);
  assert.deepEqual(m.source_names, ["frame_1.webp", "frame_2.webp", "frame_10.webp"]);
  assert.equal(m.extension, "webp");
  assert.equal(m.prefix, "frame_");
  assert.equal(exportFrameName(m, 0), "frame_0001.webp");
  assert.equal(exportFrameName(m, 2), "frame_0003.webp");
});

test("inferManifest rejects mixed types and duplicate names", () => {
  assert.throws(
    () => inferManifest(["a.webp", "b.jpg"]),
    /same type/
  );
  assert.throws(
    () => inferManifest(["seq/a.webp", "other/a.webp"]),
    /same filename/
  );
  assert.throws(() => inferManifest(["readme.txt"]), /No images/);
});

test("jpeg extension is normalized", () => {
  const m = inferManifest(["IMG_001.JPEG", "IMG_002.JPEG"]);
  assert.equal(m.extension, "jpg");
  assert.equal(m.format, "jpeg");
});

test("export HTML escapes copy and applies theme", () => {
  const html = buildIndexHtml({
    captionA: 'Hello <b>"x"</b>',
    captionB: "Line two",
    after: "After & more",
    theme: "light",
    font: "playfair",
  });
  assert.match(html, /data-theme="light"/);
  assert.match(html, /Hello &lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
  assert.match(html, /After &amp; more/);
  assert.match(html, /Playfair\+Display/);
  assert.equal(escapeHtml("<"), "&lt;");
});

test("vendored fflate can zip and unzip site files", () => {
  const packed = zipSync({
    "index.html": strToU8(buildIndexHtml({ theme: "dark" })),
    "hero-sequence/manifest.json": strToU8('{"total_frames":2}\n'),
  });
  const out = unzipSync(packed);
  assert.match(strFromU8(out["index.html"]), /data-theme="dark"/);
  assert.match(strFromU8(out["hero-sequence/manifest.json"]), /total_frames/);
});
