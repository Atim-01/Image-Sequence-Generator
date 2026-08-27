# Scroll Site Studio

Drop a folder (or zip) of video frames in the browser. Type two lines, pick a font and a light or dark page, preview the scroll, then download a **clean static site**. Nothing is uploaded to a server. Works on Vercel.

The optional CLI in this repo still extracts a GSAP-ready **WebP sequence** from a video if you want numbered frames without a random converter.

## Use the studio

```bash
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

1. Export stills from your video (WebP, JPG, or PNG, numbered, ideally ≤ 240 frames).
2. Drop the folder or zip on the page — or click **Or try sample frames**.
3. Edit the overlay lines, font, and background.
4. Scroll the preview.
5. **Download site** → `scroll-site.zip`. Unzip and host it anywhere (including Vercel). That zip is the public page, not the studio.

### Getting frames (non-technical)

Any converter that exports a numbered image sequence is fine. On Windows you can also send **`Make-Sequence.bat`**:

1. Install FFmpeg: `winget install Gyan.FFmpeg`
2. Close every terminal (log out if `ffmpeg` is still “not found”).
3. Drag a video onto `Make-Sequence.bat`.

A `YourVideo_frames` folder appears next to the video (`frame_0001.webp` … and `manifest.json`). Drop that folder on the studio.

### Deploy the studio on Vercel

Root of this repo. Vercel should publish the `public/` folder (see `vercel.json`). If the site 404s, set **Root Directory** to `public` in the project settings.

## CLI (optional)

Extract a WebP sequence from one video. One FFmpeg pass, padded filenames, a `manifest.json` the frontend can fetch so you never hardcode `total_frames` again.

### Prerequisites

- **Node.js 18+**
- **FFmpeg** with `libwebp` (full builds, not slim)

```bash
# Windows
winget install Gyan.FFmpeg

# macOS
brew install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg
```

Restart the terminal after installing so `ffmpeg` and `ffprobe` are on `PATH`.

### Usage

```bash
npm run sequence -- source/hero.mp4 -o public/hero-sequence
```

Or:

```bash
node scripts/extract-frames.js source/hero.mp4 -o public/hero-sequence
```

Re-running into a non-empty folder **fails** unless you pass `--force` (it only deletes `frame_*.webp` and `manifest.json` in that folder). Preview a sequence locally at [http://127.0.0.1:4173/preview.html](http://127.0.0.1:4173/preview.html) after extracting into `public/hero-sequence`.

### Defaults (no extra flags)

| Setting | Default | Why |
|---|---|---|
| Frame rate | 24 fps | Scroll sequences do not need 60 fps |
| Cap | 240 frames | ~8s at 30fps; keeps payload sane |
| Max width | 1920 | Never upscales; 4K is wasted on stills |
| Quality | 75 | Starting point; tune with `--max-mb` or `-q` |
| Names | `frame_0001.webp` … | 1-based, zero-padded |

A 4s clip becomes **~96 frames**, not 240. The cap is a **maximum**, not a target. Pass `--frames 240` when you want an exact count.

### Flags

```
node scripts/extract-frames.js <video> -o <folder> [options]
```

| Flag | Meaning |
|---|---|
| `-o, --out` | **Required.** Output folder |
| `--frames <n>` | Exact frame count, evenly sampled (ignores `--cap`) |
| `--fps <n>` | Used when `--frames` is omitted `[24]` |
| `--cap <n>` | Max frames in fps mode `[240]` |
| `--max-width <px>` | Downscale cap `[1920]` |
| `-q, --quality <0-100>` | WebP quality `[75]` |
| `--prefix <name>` | Filename prefix `[frame_]` |
| `--max-mb <n>` | Opt-in size budget; may lower quality to fit |
| `--min-quality <0-100>` | Floor for `--max-mb` `[50]` |
| `-f, --force` | Replace existing frames in the output folder |

### Examples

```bash
# Exact 240 frames for a ScrollTrigger scrub (evenly sampled)
npm run sequence -- source/hero.mp4 -o public/hero-sequence --frames 240

# Standard 24fps, still capped at 240
npm run sequence -- source/hero.mp4 -o public/hero-sequence

# Keep a 5 MB budget (quality steps down to 50, then fails with a hint)
npm run sequence -- source/hero.mp4 -o public/hero-sequence --frames 240 --max-mb 5

# Tighter encode, 1280px wide
npm run sequence -- source/hero.mp4 -o public/hero-sequence --max-width 1280 -q 70 --force
```

`--max-mb` samples 10 frames **evenly across the clip** (not the first 10), projects folder size, and steps quality down by 5. It will not silently change resolution or frame count. If it still cannot fit at `--min-quality`, it exits and tells you to raise the budget or drop `--frames` / `--max-width`.

## Manifest

Written to `<out>/manifest.json`. `total_frames` is the number of files on disk (FFmpeg’s `fps` filter can be off by one). The studio writes the same shape when you download a site.

```json
{
  "total_frames": 240,
  "start_number": 1,
  "pad": 4,
  "prefix": "frame_",
  "extension": "webp",
  "pattern": "frame_%04d.webp",
  "first_frame": "frame_0001.webp",
  "last_frame": "frame_0240.webp",
  "format": "webp",
  "width": 1920,
  "height": 1080,
  "quality": 75,
  "quality_requested": 75,
  "fps": 24,
  "folder_size_mb": 4.87,
  "source": "hero.mp4",
  "max_mb": 5
}
```

`folder_size_mb` is decimal megabytes (bytes / 1e6).
