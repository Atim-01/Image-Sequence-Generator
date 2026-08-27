import { createCoverCanvas } from "./canvas.js";
import { loadManifest, preloadSequence } from "./sequence.js";
import { createHeroTimeline } from "./timeline.js";
import { applyChrome, isStudioPreview } from "./site-chrome.js";

const loader = document.querySelector("#loader");
const bar = document.querySelector("[data-loader-bar]");
const pct = document.querySelector("[data-loader-pct]");
const label = document.querySelector(".loader__label");

function setProgress(done, total) {
  const ratio = total ? done / total : 0;
  bar.style.width = `${Math.round(ratio * 100)}%`;
  pct.textContent = `${Math.round(ratio * 100)}%`;
}

function showError(err) {
  pct.textContent = "Error";
  if (label) label.textContent = err.message;
  console.error(err);
}

function waitForStudioConfig() {
  return new Promise((resolve, reject) => {
    if (label) label.textContent = "Waiting for frames";
    const timer = window.setTimeout(() => {
      reject(new Error("Preview timed out. Drop your frames again."));
    }, 30000);

    function onMessage(event) {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (data?.type === "preview-config") {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data.config);
      }
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "preview-ready" }, location.origin);
  });
}

async function bootFromConfig(config) {
  applyChrome(config);
  const manifest = config.manifest ?? (await loadManifest());
  const images = await preloadSequence(manifest, {
    frameUrls: config.frameUrls,
    onProgress: setProgress,
  });
  return { manifest, images };
}

function listenForChromeUpdates() {
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === "preview-update") {
      applyChrome(event.data.config);
      window.ScrollTrigger?.refresh();
    }
  });
}

async function boot() {
  if (!window.gsap || !window.ScrollTrigger) {
    throw new Error("GSAP / ScrollTrigger failed to load");
  }

  const config = isStudioPreview() ? await waitForStudioConfig() : {};
  if (label) label.textContent = "Loading sequence";

  const { manifest, images } = await bootFromConfig(config);
  const lastFrame = manifest.total_frames - 1;

  const canvas = document.querySelector("#hero-canvas");
  const view = createCoverCanvas(canvas);
  const state = { frame: 0 };
  view.drawFrame(images, 0);

  createHeroTimeline({
    gsap: window.gsap,
    ScrollTrigger: window.ScrollTrigger,
    state,
    lastFrame,
    captions: window.gsap.utils.toArray(".hero__line"),
    hint: document.querySelector(".hero__hint"),
    onFrame: (frame) => view.drawFrame(images, frame),
  });

  listenForChromeUpdates();
  loader.classList.add("is-done");
  requestAnimationFrame(() => window.ScrollTrigger.refresh());
}

boot().catch(showError);
