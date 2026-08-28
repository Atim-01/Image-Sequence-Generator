import {
  MAX_BYTES,
  MAX_FRAMES,
  basename,
  inferManifest,
  isImageName,
  shouldSkipPath,
} from "./infer-manifest.js";
import { DEFAULT_COPY, FONTS } from "./site-chrome.js";
import { buildSiteZip, unzipFiles } from "./export-site.js";

const drop = document.querySelector("#drop");
const fileInput = document.querySelector("#file-input");
const dirInput = document.querySelector("#dir-input");
const statusEl = document.querySelector("#status");
const progress = document.querySelector("#progress");
const progressBar = document.querySelector("#progress-bar");
const progressLabel = document.querySelector("#progress-label");
const downloadBtn = document.querySelector("#download");
const fontSelect = document.querySelector("#font");
const iframe = document.querySelector("#preview");
const empty = document.querySelector("#empty");

const fields = {
  captionA: document.querySelector("#caption-a"),
  captionB: document.querySelector("#caption-b"),
  after: document.querySelector("#caption-after"),
  font: fontSelect,
};

let sequence = null;
let urls = [];
let previewReady = false;
let pendingConfig = null;

for (const [id, font] of Object.entries(FONTS)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = font.label;
  if (id === DEFAULT_COPY.font) opt.selected = true;
  fontSelect.append(opt);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setProgress(label, ratio = null) {
  progress.classList.remove("is-hidden");
  progress.setAttribute("aria-hidden", "false");
  progressLabel.textContent = label;
  progressBar.style.width =
    ratio == null ? "30%" : `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
}

function hideProgress() {
  progress.classList.add("is-hidden");
  progress.setAttribute("aria-hidden", "true");
  progressBar.style.width = "0%";
}

function revokeUrls() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
}

function copyFromForm() {
  const theme =
    document.querySelector('input[name="theme"]:checked')?.value ?? "dark";
  return {
    captionA: fields.captionA.value.trim(),
    captionB: fields.captionB.value.trim(),
    after: fields.after.value.trim(),
    font: fields.font.value || DEFAULT_COPY.font,
    theme,
  };
}

function previewConfig(includeFrames) {
  const copy = copyFromForm();
  if (!includeFrames) return copy;
  return {
    ...copy,
    manifest: sequence.manifest,
    frameUrls: urls,
  };
}

function postToPreview(payload) {
  iframe.contentWindow?.postMessage(payload, location.origin);
}

function sendConfig() {
  if (!sequence) return;
  if (!previewReady) {
    pendingConfig = { type: "preview-config", config: previewConfig(true) };
    return;
  }
  postToPreview({ type: "preview-config", config: previewConfig(true) });
}

function sendChrome() {
  if (!sequence) return;
  if (!previewReady) {
    pendingConfig = { type: "preview-config", config: previewConfig(true) };
    return;
  }
  postToPreview({ type: "preview-update", config: copyFromForm() });
}

function formatMb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function describe(manifest, bytes) {
  const kind = (manifest.extension || "image").toUpperCase();
  const n = manifest.total_frames;
  let message = `${n} ${kind} frames · ${formatMb(bytes)}`;
  if (n > MAX_FRAMES) {
    message += " — that’s a lot; the page may load slowly.";
  }
  return message;
}

async function probeSize(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function collectDroppedFiles(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  if (items.some((item) => item.webkitGetAsEntry)) {
    const nested = await Promise.all(items.map((item) => readEntry(item.webkitGetAsEntry())));
    const files = nested.flat().filter(Boolean);
    if (files.length) return files;
  }
  return [...(dataTransfer.files || [])];
}

function readEntry(entry) {
  if (!entry) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file(resolve, reject)).then((file) => [
      file,
    ]);
  }
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = entry.createReader();
  return readAllEntries(reader).then((entries) =>
    Promise.all(entries.map(readEntry)).then((groups) => groups.flat())
  );
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        pump();
      }, reject);
    };
    pump();
  });
}

function isZipFile(file) {
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".zip") || file.type === "application/zip";
}

async function expandFiles(inputFiles) {
  const zips = inputFiles.filter(isZipFile);
  const rest = inputFiles.filter((file) => !isZipFile(file));
  if (!zips.length) return rest;
  setProgress("Reading zip…", 0.15);
  const unzipped = [];
  for (const zip of zips) {
    unzipped.push(...(await unzipFiles(await zip.arrayBuffer())));
  }
  return [...rest, ...unzipped];
}

function toNamedList(fileList) {
  return fileList.map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }));
}

async function ingest(rawFiles) {
  if (!rawFiles.length) {
    throw Object.assign(new Error("Nothing dropped."), { user: true });
  }

  setProgress("Reading files…", 0.2);
  const expanded = await expandFiles(rawFiles);
  const named = toNamedList(expanded).filter(
    ({ path }) => !shouldSkipPath(path) && (isImageName(path) || basename(path) === "manifest.json")
  );
  const imagePaths = named.filter(({ path }) => isImageName(path)).map(({ path }) => path);
  const manifest = inferManifest(imagePaths);
  const byBase = new Map(
    named
      .filter(({ path }) => isImageName(path))
      .map(({ path, file }) => [basename(path), file])
  );
  const files = manifest.source_names.map((name) => byBase.get(name)).filter(Boolean);
  if (files.length !== manifest.total_frames) {
    throw Object.assign(new Error("Could not match every frame file."), { user: true });
  }

  const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (bytes > MAX_BYTES) {
    throw Object.assign(
      new Error(`Those frames are ${formatMb(bytes)}. Keep the folder under ${formatMb(MAX_BYTES)}.`),
      { user: true }
    );
  }

  setProgress("Preparing preview…", 0.55);
  let size = { width: 0, height: 0 };
  try {
    size = await probeSize(files[0]);
  } catch {
    /* optional */
  }

  const fullManifest = {
    ...manifest,
    width: size.width || undefined,
    height: size.height || undefined,
    folder_size_mb: Number((bytes / 1e6).toFixed(2)),
  };
  delete fullManifest.source_names;

  revokeUrls();
  urls = files.map((file) => URL.createObjectURL(file));
  sequence = { manifest: fullManifest, files, bytes };
  downloadBtn.disabled = false;
  empty.classList.add("is-hidden");
  empty.setAttribute("aria-hidden", "true");
  iframe.classList.remove("is-hidden");
  hideProgress();
  setStatus(describe(fullManifest, bytes));
  previewReady = false;
  iframe.src = `./preview.html?studio=1&t=${Date.now()}`;
  pendingConfig = { type: "preview-config", config: previewConfig(true) };
}

async function makeSampleFrames() {
  setProgress("Making sample frames…", 0.1);
  const total = 48;
  const width = 1600;
  const height = 900;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const cx = width / 2;
  const cy = height / 2 + 20;
  const files = [];

  function rotX(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  }
  function rotY(p, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c };
  }
  function project(p) {
    const z = p.z + 640;
    const s = 520 / z;
    return { x: cx + p.x * s, y: cy + p.y * s, z, s };
  }
  function place(p, spin, tilt) {
    return project(rotY(rotX(p, tilt), spin));
  }

  const pearls = [];
  for (let j = 0; j < 14; j++) {
    const u = (j / 14) * Math.PI * 2;
    pearls.push({
      x: 210 * Math.cos(u),
      y: 18 * Math.sin(u * 2),
      z: 210 * Math.sin(u),
      r: 22 + (j % 3) * 5,
      blush: j % 2 === 0,
    });
  }
  for (let j = 0; j < 8; j++) {
    const u = (j / 8) * Math.PI * 2 + 0.4;
    pearls.push({
      x: 320 * Math.cos(u),
      y: -70 + 90 * Math.sin(u * 1.5),
      z: 140 * Math.sin(u),
      r: 12 + (j % 4) * 3,
      blush: true,
    });
  }

  function drawSphere(x, y, r, blush, depth) {
    const falloff = Math.max(0.35, Math.min(1, 1.15 - depth / 1400));
    const gx = x - r * 0.32;
    const gy = y - r * 0.38;
    const g = ctx.createRadialGradient(gx, gy, r * 0.08, x, y, r);
    if (blush) {
      g.addColorStop(0, `rgba(255, 248, 242, ${0.95 * falloff})`);
      g.addColorStop(0.22, `rgba(255, 214, 204, ${0.95 * falloff})`);
      g.addColorStop(0.62, `rgba(232, 154, 148, ${0.92 * falloff})`);
      g.addColorStop(1, `rgba(92, 38, 48, ${0.92 * falloff})`);
    } else {
      g.addColorStop(0, `rgba(255, 249, 232, ${0.95 * falloff})`);
      g.addColorStop(0.2, `rgba(244, 214, 140, ${0.95 * falloff})`);
      g.addColorStop(0.58, `rgba(196, 150, 72, ${0.92 * falloff})`);
      g.addColorStop(1, `rgba(62, 40, 18, ${0.92 * falloff})`);
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(gx, gy, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 252, ${0.45 * falloff})`;
    ctx.fill();
  }

  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    const spin = t * Math.PI * 1.45;
    const tilt = 0.42 + Math.sin(t * Math.PI) * 0.08;
    const camLift = Math.sin(t * Math.PI) * 16;

    const sky = ctx.createRadialGradient(cx, cy - 80, 40, cx, cy, 820);
    sky.addColorStop(0, "#3a1824");
    sky.addColorStop(0.45, "#160910");
    sky.addColorStop(1, "#070506");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const bloom = ctx.createRadialGradient(cx, cy - 10, 20, cx, cy, 340);
    bloom.addColorStop(0, "rgba(255, 186, 168, 0.28)");
    bloom.addColorStop(0.45, "rgba(228, 197, 106, 0.1)");
    bloom.addColorStop(1, "rgba(7, 5, 6, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    for (let d = 0; d < 40; d++) {
      const seed = d * 17.17;
      const px = ((seed * 73 + t * 90) % width);
      const py = (seed * 47) % height;
      const pr = 0.6 + (d % 4) * 0.4;
      ctx.fillStyle = `rgba(255, 230, 210, ${0.08 + (d % 5) * 0.03})`;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    for (let k = 0; k <= 100; k++) {
      const u = (k / 100) * Math.PI * 4 + spin * 0.35;
      const p = {
        x: 180 * Math.cos(u),
        y: 52 * Math.sin(u * 0.75) - camLift,
        z: 180 * Math.sin(u),
      };
      const q = place(p, spin, tilt);
      if (k === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.strokeStyle = "rgba(244, 214, 140, 0.55)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 236, 210, 0.85)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    const sprites = pearls.map((pearl) => {
      const q = place(
        { x: pearl.x, y: pearl.y - camLift, z: pearl.z },
        spin,
        tilt
      );
      return { ...q, r: Math.max(4, pearl.r * q.s), blush: pearl.blush };
    });
    const core = place({ x: 0, y: -camLift, z: 0 }, spin, tilt);
    sprites.push({
      ...core,
      r: Math.max(28, 78 * core.s),
      blush: false,
    });

    sprites.sort((a, b) => b.z - a.z);
    for (const ball of sprites) {
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + ball.r * 0.85, ball.r * 0.7, ball.r * 0.18, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
      ctx.fill();
      drawSphere(ball.x, ball.y, ball.r, ball.blush, ball.z);
    }

    const veil = ctx.createLinearGradient(0, 0, 0, height);
    veil.addColorStop(0, "rgba(7, 5, 6, 0.28)");
    veil.addColorStop(0.35, "rgba(7, 5, 6, 0)");
    veil.addColorStop(0.8, "rgba(7, 5, 6, 0)");
    veil.addColorStop(1, "rgba(20, 8, 12, 0.45)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Could not create sample frames in this browser."));
      }, "image/jpeg", 0.88);
    });
    files.push(
      new File([blob], `frame_${String(i + 1).padStart(4, "0")}.jpg`, { type: "image/jpeg" })
    );
    setProgress(`Making sample frames… ${i + 1}/${total}`, (i + 1) / total);
  }

  await ingest(files);
}

async function handleFiles(fileList) {
  try {
    downloadBtn.disabled = true;
    await ingest([...fileList]);
  } catch (err) {
    hideProgress();
    setStatus(err.message || String(err), true);
    console.error(err);
  }
}

async function downloadSite() {
  if (!sequence) return;
  try {
    downloadBtn.disabled = true;
    setProgress("Building zip…", 0.4);
    const copy = copyFromForm();
    const zipped = await buildSiteZip({
      manifest: sequence.manifest,
      files: sequence.files,
      copy,
    });
    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scroll-site.zip";
    a.click();
    URL.revokeObjectURL(url);
    hideProgress();
    setStatus(`Saved scroll-site.zip · ${describe(sequence.manifest, sequence.bytes)}`);
  } catch (err) {
    hideProgress();
    setStatus(err.message || "Could not build the zip.", true);
    console.error(err);
  } finally {
    downloadBtn.disabled = false;
  }
}

drop.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  fileInput.click();
});

drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("is-over");
});

drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));

drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("is-over");
  collectDroppedFiles(event.dataTransfer).then(handleFiles);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
  fileInput.value = "";
});

dirInput.addEventListener("change", () => {
  if (dirInput.files?.length) handleFiles(dirInput.files);
  dirInput.value = "";
});

document.querySelector("[data-pick-files]").addEventListener("click", (event) => {
  event.stopPropagation();
  fileInput.click();
});

document.querySelector("[data-pick-folder]").addEventListener("click", (event) => {
  event.stopPropagation();
  dirInput.click();
});

document.querySelector("[data-sample]").addEventListener("click", (event) => {
  event.stopPropagation();
  makeSampleFrames().catch((err) => {
    hideProgress();
    setStatus(err.message || String(err), true);
  });
});

downloadBtn.addEventListener("click", downloadSite);

for (const el of [fields.captionA, fields.captionB, fields.after, fields.font]) {
  el.addEventListener("input", sendChrome);
  el.addEventListener("change", sendChrome);
}
for (const el of document.querySelectorAll('input[name="theme"]')) {
  el.addEventListener("change", sendChrome);
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === "preview-ready") {
    previewReady = true;
    if (pendingConfig) {
      postToPreview(pendingConfig);
      pendingConfig = null;
    } else {
      sendConfig();
    }
  }
});

window.addEventListener("beforeunload", revokeUrls);

const studio = document.querySelector("#studio");
const collapseSidebarBtn = document.querySelector("#collapse-sidebar");
const expandSidebarBtn = document.querySelector("#expand-sidebar");
const collapsePreviewBtn = document.querySelector("#collapse-preview");
const expandPreviewBtn = document.querySelector("#expand-preview");
const expandPreviewRail = document.querySelector("#expand-preview-rail");

function notifyPreviewLayout() {
  requestAnimationFrame(() => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.dispatchEvent(new Event("resize"));
    win.ScrollTrigger?.refresh();
  });
}

function setLayout(mode) {
  studio.classList.toggle("is-sidebar-collapsed", mode === "preview");
  studio.classList.toggle("is-preview-collapsed", mode === "sidebar");
  collapseSidebarBtn?.setAttribute("aria-expanded", String(mode !== "preview"));
  collapsePreviewBtn?.setAttribute("aria-expanded", String(mode !== "sidebar"));
  notifyPreviewLayout();
}

function currentLayout() {
  if (studio.classList.contains("is-sidebar-collapsed")) return "preview";
  if (studio.classList.contains("is-preview-collapsed")) return "sidebar";
  return "split";
}

collapseSidebarBtn?.addEventListener("click", () => setLayout("preview"));
expandSidebarBtn?.addEventListener("click", () => setLayout("split"));
expandPreviewBtn?.addEventListener("click", () => setLayout("preview"));
collapsePreviewBtn?.addEventListener("click", () => setLayout("sidebar"));
expandPreviewRail?.addEventListener("click", () => setLayout("split"));

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && currentLayout() !== "split") {
    setLayout("split");
  }
});
