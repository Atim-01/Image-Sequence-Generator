import { exportFrameName } from "./infer-manifest.js";
import { DEFAULT_COPY, fontHref } from "./site-chrome.js";

const ASSET_URLS = [
  ["css/hero.css", "./css/hero.css"],
  ["js/canvas.js", "./js/canvas.js"],
  ["js/sequence.js", "./js/sequence.js"],
  ["js/timeline.js", "./js/timeline.js"],
  ["js/site-chrome.js", "./js/site-chrome.js"],
  ["js/main.js", "./js/main.js"],
];

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildIndexHtml({
  captionA = DEFAULT_COPY.captionA,
  captionB = DEFAULT_COPY.captionB,
  after = DEFAULT_COPY.after,
  theme = "dark",
  font = "cormorant",
} = {}) {
  const safeTheme = theme === "light" ? "light" : "dark";
  return `<!DOCTYPE html>
<html lang="en" data-theme="${safeTheme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hero Sequence</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="${fontHref(font)}" rel="stylesheet" data-fonts />
    <link rel="stylesheet" href="./css/hero.css" />
  </head>
  <body>
    <div id="loader" class="loader" aria-live="polite">
      <p class="loader__label">Loading sequence</p>
      <div class="loader__track">
        <div class="loader__bar" data-loader-bar></div>
      </div>
      <p class="loader__pct" data-loader-pct>0%</p>
    </div>

    <section id="hero" class="hero">
      <canvas id="hero-canvas" class="hero__canvas"></canvas>
      <div class="hero__copy">
        <h1 class="hero__line" data-caption="a">${escapeHtml(captionA)}</h1>
        <h1 class="hero__line" data-caption="b">${escapeHtml(captionB)}</h1>
      </div>
      <p class="hero__hint">Scroll</p>
    </section>

    <section class="after" id="after">
      <p>${escapeHtml(after)}</p>
    </section>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js"></script>
    <script type="module" src="./js/main.js"></script>
  </body>
</html>
`;
}

async function loadFflate() {
  return import("../vendor/fflate.js");
}

export async function unzipFiles(buffer) {
  const { unzipSync } = await loadFflate();
  const entries = unzipSync(new Uint8Array(buffer));
  return Object.entries(entries)
    .filter(([name, data]) => data?.length && !name.endsWith("/"))
    .map(([name, data]) => {
      const base = name.replace(/\\/g, "/").split("/").pop() || name;
      const lower = base.toLowerCase();
      let type = "application/octet-stream";
      if (lower.endsWith(".webp")) type = "image/webp";
      else if (lower.endsWith(".png")) type = "image/png";
      else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) type = "image/jpeg";
      else if (lower.endsWith(".gif")) type = "image/gif";
      else if (lower.endsWith(".json")) type = "application/json";
      return new File([data], name, { type });
    });
}

async function fetchAsset(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not pack ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function buildSiteZip({ manifest, files, copy }) {
  const { zipSync, strToU8 } = await loadFflate();
  const packed = {
    "index.html": strToU8(buildIndexHtml(copy)),
    "hero-sequence/manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  await Promise.all(
    ASSET_URLS.map(async ([dest, url]) => {
      packed[dest] = await fetchAsset(url);
    })
  );

  await Promise.all(
    files.map(async (file, index) => {
      const name = exportFrameName(manifest, index);
      packed[`hero-sequence/${name}`] = new Uint8Array(await file.arrayBuffer());
    })
  );

  return zipSync(packed, { level: 6 });
}
