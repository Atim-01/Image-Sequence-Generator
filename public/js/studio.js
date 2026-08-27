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
  const total = 36;
  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const files = [];

  for (let i = 0; i < total; i++) {
    const t = i / (total - 1);
    ctx.fillStyle = "#070706";
    ctx.fillRect(0, 0, width, height);
    const x = width * (0.18 + t * 0.55);
    const g = ctx.createRadialGradient(x, height * 0.52, 40, x, height * 0.52, 420);
    g.addColorStop(0, `rgba(228, 197, 106, ${0.55 + t * 0.35})`);
    g.addColorStop(1, "rgba(7, 7, 6, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#e4c56a";
    ctx.fillRect(0, height - 8, Math.round(width * t), 8);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Could not create sample frames in this browser."));
      }, "image/jpeg", 0.72);
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
