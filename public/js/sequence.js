const SEQUENCE_BASE = "./hero-sequence";
const MANIFEST_URL = `${SEQUENCE_BASE}/manifest.json`;

export function frameUrl(manifest, index, base = SEQUENCE_BASE) {
  const start = manifest.start_number ?? 1;
  const pad = manifest.pad ?? 4;
  const prefix = manifest.prefix ?? "frame_";
  const ext = manifest.extension ?? "webp";
  const id = String(start + index).padStart(pad, "0");
  return `${base}/${prefix}${id}.${ext}`;
}

export async function loadManifest(url = MANIFEST_URL) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not fetch manifest (${res.status})`);
  }
  const manifest = await res.json();
  if (!manifest.total_frames) {
    throw new Error("manifest.json is missing total_frames");
  }
  return manifest;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = async () => {
      try {
        await img.decode();
      } catch {
        /* decode is best-effort */
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

async function loadFrame(src) {
  const img = await loadImage(src);
  if (typeof createImageBitmap !== "function") return img;
  try {
    const bitmap = await createImageBitmap(img, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
      resizeQuality: "high",
    });
    img.src = "";
    return bitmap;
  } catch {
    return img;
  }
}

export async function preloadSequence(
  manifest,
  { base = SEQUENCE_BASE, frameUrls, onProgress, concurrency = 12 } = {}
) {
  const total = manifest.total_frames;
  const images = new Array(total);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < total) {
      const index = cursor++;
      const src = frameUrls?.[index] ?? frameUrl(manifest, index, base);
      images[index] = await loadFrame(src);
      done += 1;
      onProgress?.(done, total);
    }
  }

  const pool = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return images;
}
