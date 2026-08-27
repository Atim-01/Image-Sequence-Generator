/** Infer a GSAP-ready manifest from a loose folder or zip of stills. */

export const MAX_FRAMES = 240;
export const HARD_MAX_FRAMES = 300;
export const MAX_BYTES = 80 * 1e6;

const IMAGE_EXT = /^(webp|jpe?g|png|gif)$/i;

export function normalizeExt(ext) {
  const e = String(ext || "")
    .toLowerCase()
    .replace(/^\./, "");
  if (e === "jpeg") return "jpg";
  return e;
}

export function basename(path) {
  const parts = String(path)
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

export function shouldSkipPath(path) {
  const n = String(path).replace(/\\/g, "/");
  if (n.includes("__MACOSX/")) return true;
  const base = basename(n);
  if (!base || base.startsWith(".")) return true;
  if (base === "Thumbs.db" || base === "desktop.ini") return true;
  return false;
}

export function isImageName(name) {
  const m = basename(name).match(/\.([a-z0-9]+)$/i);
  return Boolean(m && IMAGE_EXT.test(m[1]));
}

export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function parseFrameName(name) {
  const base = basename(name);
  const m = base.match(/^(.*?)(\d+)\.([a-z0-9]+)$/i);
  if (!m || !IMAGE_EXT.test(m[3])) return null;
  return {
    name: base,
    prefix: m[1],
    index: Number(m[2]),
    pad: m[2].length,
    ext: normalizeExt(m[3]),
  };
}

function userError(message) {
  const err = new Error(message);
  err.user = true;
  return err;
}

export function inferManifest(fileNames, { maxFrames = HARD_MAX_FRAMES } = {}) {
  const names = fileNames
    .filter((n) => !shouldSkipPath(n) && isImageName(n))
    .map(basename);

  if (names.length === 0) {
    throw userError("No images found. Use a folder of .webp, .jpg, or .png frames.");
  }
  if (new Set(names).size !== names.length) {
    throw userError("Two frames have the same filename. Put them in a single folder.");
  }
  if (names.length > maxFrames) {
    throw userError(
      `Too many frames (${names.length}). Use ${maxFrames} or fewer so the page stays fast.`
    );
  }

  const parsed = names.map(parseFrameName);
  const exts = new Set(
    names.map((n) => {
      const ext = n.split(".").pop();
      return normalizeExt(ext);
    })
  );
  if (exts.size > 1) {
    throw userError("All frames need the same type (all WebP, or all JPG, or all PNG).");
  }

  const ext = [...exts][0];
  const numbered = parsed.every(Boolean);
  let ordered = [...names].sort(naturalCompare);
  if (numbered) {
    ordered = names
      .map((name, i) => ({ name, index: parsed[i].index }))
      .sort((a, b) => a.index - b.index || naturalCompare(a.name, b.name))
      .map((x) => x.name);
  }

  const pad = Math.max(4, String(ordered.length).length);
  const format = ext === "jpg" ? "jpeg" : ext;

  return {
    total_frames: ordered.length,
    start_number: 1,
    pad,
    prefix: "frame_",
    extension: ext,
    pattern: `frame_%0${pad}d.${ext}`,
    first_frame: `frame_${String(1).padStart(pad, "0")}.${ext}`,
    last_frame: `frame_${String(ordered.length).padStart(pad, "0")}.${ext}`,
    format,
    source_names: ordered,
  };
}

export function exportFrameName(manifest, index) {
  const n = (manifest.start_number ?? 1) + index;
  const pad = manifest.pad ?? 4;
  const prefix = manifest.prefix ?? "frame_";
  const ext = manifest.extension ?? "webp";
  return `${prefix}${String(n).padStart(pad, "0")}.${ext}`;
}

export function pickImageEntries(paths) {
  return paths.filter((n) => !shouldSkipPath(n) && isImageName(n));
}
