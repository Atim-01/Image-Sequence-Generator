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
      colorSpace: "srgb",
    }) || canvas.getContext("2d", { alpha: false });

  let current = null;
  let lastIndex = -1;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    const width = Math.max(1, Math.round(cssW * dpr));
    const height = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      lastIndex = -1;
    }

    if (current) draw(current);
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = scale < 0.98 || scale > 1.02;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h, dx, dy, dw, dh);
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
  window.visualViewport?.addEventListener("resize", resize);
  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => resize())
      : null;
  observer?.observe(canvas);

  return {
    resize,
    draw,
    drawFrame,
    destroy: () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      observer?.disconnect();
    },
  };
}
