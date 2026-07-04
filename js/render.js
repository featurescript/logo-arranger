// render.js — draw the arrangement to the canvas, hit-test for dragging, and
// export a flattened PNG. A "placed" item is:
//   { logo, x, y, displayW, displayH, r }  (x,y = center, canvas px)

export function draw(ctx, area, placed, opts = {}) {
  const { width, height } = area;
  ctx.clearRect(0, 0, width, height);

  if (opts.whiteBg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  if (opts.showArea) drawOutline(ctx, area);

  for (const p of placed) {
    ctx.drawImage(
      p.logo.canvas,
      p.x - p.displayW / 2,
      p.y - p.displayH / 2,
      p.displayW,
      p.displayH,
    );
    if (opts.debug) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(91,140,255,0.6)';
      ctx.stroke();
    }
  }
}

export function drawOutline(ctx, area) {
  ctx.save();
  ctx.strokeStyle = 'rgba(123,91,255,0.55)';
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  const { type, width, height } = area;

  if (type === 'rect') {
    ctx.strokeRect(1, 1, width - 2, height - 2);
  } else if (type === 'circle') {
    const r = Math.min(width, height) / 2 - 1;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2 - 1, height / 2 - 1, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'polygon' && area.polygon && area.polygon.length >= 2) {
    ctx.beginPath();
    area.polygon.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'mask' && area.maskCanvas) {
    ctx.globalAlpha = 0.12;
    ctx.setLineDash([]);
    ctx.drawImage(area.maskCanvas, 0, 0, width, height);
  }
  ctx.restore();
}

// Return the index of the topmost placed logo under (x,y) in canvas coords.
export function hitTest(placed, x, y) {
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i];
    if (
      x >= p.x - p.displayW / 2 && x <= p.x + p.displayW / 2 &&
      y >= p.y - p.displayH / 2 && y <= p.y + p.displayH / 2
    ) {
      // refine with alpha so transparent corners don't grab
      if (alphaHit(p, x, y)) return i;
    }
  }
  return -1;
}

function alphaHit(p, x, y) {
  const lx = Math.floor(((x - (p.x - p.displayW / 2)) / p.displayW) * p.logo.canvas.width);
  const ly = Math.floor(((y - (p.y - p.displayH / 2)) / p.displayH) * p.logo.canvas.height);
  if (lx < 0 || ly < 0 || lx >= p.logo.canvas.width || ly >= p.logo.canvas.height) return false;
  try {
    const a = p.logo.canvas.getContext('2d').getImageData(lx, ly, 1, 1).data[3];
    return a > 12;
  } catch {
    return true;
  }
}

// Map a pointer event to canvas (logical) coordinates.
export function eventToCanvas(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);
  return { x: cx, y: cy };
}

export function exportPNG(area, placed, opts = {}) {
  const scale = opts.exportScale || 2;
  const out = document.createElement('canvas');
  out.width = Math.round(area.width * scale);
  out.height = Math.round(area.height * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  draw(ctx, area, placed, { whiteBg: opts.whiteBg, showArea: false });
  out.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logo-arrangement.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
