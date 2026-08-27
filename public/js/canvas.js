const MAX_DPR = 2;

function sourceSize(img) {
  return {
    w: img.naturalWidth || img.width || 0,
    h: img.naturalHeight || img.height || 0,
  };
}

export function createCoverCanvas(canvas) {
  const ctx =
    canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      colorSpace: "srgb",
    }) || canvas.getContext("2d", { alpha: false });

  let current = null;
  let lastIndex = -1;

  function tuneContext(scale = 1) {
    const downscale = scale < 0.995;
    ctx.imageSmoothingEnabled = downscale;
    ctx.imageSmoothingQuality = "high";
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const width = Math.max(1, Math.round(cssW * dpr));
    const height = Math.max(1, Math.round(cssH * dpr));

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      lastIndex = -1;
    }

    if (current) draw(current);
    else tuneContext();
  }

  function coverRect(imgW, imgH, viewW, viewH) {
    const scale = Math.max(viewW / imgW, viewH / imgH);
    const dw = Math.round(imgW * scale);
    const dh = Math.round(imgH * scale);
    return {
      scale,
      dx: Math.round((viewW - dw) / 2),
      dy: Math.round((viewH - dh) / 2),
      dw,
      dh,
    };
  }

  function draw(img) {
    const { w, h } = sourceSize(img);
    if (!w || !h) return;
    current = img;
    const { width, height } = canvas;
    const { scale, dx, dy, dw, dh } = coverRect(w, h, width, height);
    tuneContext(scale);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawFrame(images, index) {
    const last = images.length - 1;
    const i = Math.max(0, Math.min(last, Math.round(index)));
    if (i === lastIndex && current) return i;
    lastIndex = i;
    draw(images[i]);
    return i;
  }

  resize();
  window.addEventListener("resize", resize);

  return {
    resize,
    draw,
    drawFrame,
    destroy: () => window.removeEventListener("resize", resize),
  };
}
