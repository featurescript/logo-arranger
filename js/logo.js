// logo.js — load an image, trim to its opaque bounding box, and decompose the
// alpha footprint into a set of circles. The circle set is the collision shape
// the packer uses, so a wide wordmark collides along its whole length while a
// circular logo's transparent corners stay usable as empty space.

const ALPHA_THRESHOLD = 12; // 0–255; below this a pixel counts as transparent
const COVER_GRID = 96;      // longest side of the downsampled mask used for circle cover
const MAX_CIRCLES = 64;     // cap per logo

let uid = 0;

/**
 * Load a File into a trimmed logo descriptor.
 * Returns: {
 *   id, name, canvas, w, h,
 *   circles: [{x, y, r}]   — collision circles, trimmed-source px, relative to
 *                             the trimmed canvas CENTER
 *   boundRadius             — radius of the bounding circle of the circle set
 *   footprintRadius         — equal-area circle radius of the opaque pixels
 *   opaqueFrac, scale       — scale = user tier percent (default 100)
 * }
 */
export async function loadLogo(file) {
  const img = await fileToImage(file);
  return descriptorFromImage(img, file.name.replace(/\.[^.]+$/, ''));
}

// Exposed separately so tests can feed a canvas/image directly.
export function descriptorFromImage(img, name) {
  const { canvas, w, h, opaquePixels } = trimToOpaque(img);
  const circles = computeCircles(canvas, w, h);
  let boundRadius = 0;
  for (const c of circles) boundRadius = Math.max(boundRadius, Math.hypot(c.x, c.y) + c.r);
  return {
    id: `logo-${uid++}`,
    name,
    canvas,
    w,
    h,
    circles,
    boundRadius,
    footprintRadius: Math.sqrt(Math.max(opaquePixels, 1) / Math.PI),
    opaqueFrac: opaquePixels / (w * h || 1),
    scale: 100,
  };
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not load ${file.name}`));
    };
    img.src = url;
  });
}

// Draw the image, scan alpha, crop to the opaque bbox, and count opaque pixels.
function trimToOpaque(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = iw;
  src.height = ih;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, iw, ih);

  let minX = iw, minY = ih, maxX = -1, maxY = -1, opaque = 0;
  let data;
  try {
    data = sctx.getImageData(0, 0, iw, ih).data;
  } catch (e) {
    // Tainted canvas (rare for local files) — fall back to full image.
    return { canvas: src, w: iw, h: ih, opaquePixels: iw * ih };
  }

  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const a = data[(y * iw + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        opaque++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent (shouldn't happen) — keep original.
  if (maxX < 0) return { canvas: src, w: iw, h: ih, opaquePixels: iw * ih };

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(src, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, w, h, opaquePixels: opaque };
}

// ---------------------------------------------------------------------------
// Circle cover: downsample the trimmed alpha to a small grid, run a chamfer
// distance transform of the opaque region, then greedily place circles at the
// deepest uncovered cells until (almost) all opaque cells are covered.
// ---------------------------------------------------------------------------
function computeCircles(canvas, w, h) {
  const s = Math.min(1, COVER_GRID / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * s));
  const gh = Math.max(1, Math.round(h * s));
  const cell = 1 / s; // source px per grid cell

  const tmp = document.createElement('canvas');
  tmp.width = gw;
  tmp.height = gh;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, gw, gh);
  let data;
  try {
    data = ctx.getImageData(0, 0, gw, gh).data;
  } catch {
    // Fallback: one bounding circle.
    return [{ x: 0, y: 0, r: Math.hypot(w, h) / 2 }];
  }

  const opaque = new Uint8Array(gw * gh);
  let opaqueCount = 0;
  for (let p = 0; p < gw * gh; p++) {
    if (data[p * 4 + 3] > ALPHA_THRESHOLD) { opaque[p] = 1; opaqueCount++; }
  }
  if (!opaqueCount) return [{ x: 0, y: 0, r: Math.hypot(w, h) / 2 }];

  // Chamfer distance to the nearest transparent/outside cell.
  const INF = 1e9;
  const d = new Float32Array(gw * gh);
  const A = 1, B = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = opaque[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x]);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!opaque[y * gw + x]) continue;
      d[y * gw + x] = Math.min(d[y * gw + x], at(x - 1, y) + A, at(x, y - 1) + A, at(x - 1, y - 1) + B, at(x + 1, y - 1) + B);
    }
  for (let y = gh - 1; y >= 0; y--)
    for (let x = gw - 1; x >= 0; x--) {
      if (!opaque[y * gw + x]) continue;
      d[y * gw + x] = Math.min(d[y * gw + x], at(x + 1, y) + A, at(x, y + 1) + A, at(x + 1, y + 1) + B, at(x - 1, y + 1) + B);
    }

  // Greedy cover, deepest cells first. A cell counts as covered only when it is
  // truly inside a circle, so the collision shape can never miss opaque pixels.
  const covered = new Uint8Array(gw * gh);
  const circles = [];
  let remaining = opaqueCount;

  while (circles.length < MAX_CIRCLES && remaining > 0) {
    // deepest uncovered opaque cell
    let best = -1, bestD = 0;
    for (let p = 0; p < gw * gh; p++) {
      if (opaque[p] && !covered[p] && d[p] > bestD) { bestD = d[p]; best = p; }
    }
    if (best < 0) break;
    const bx = best % gw, by = Math.floor(best / gw);
    // Radius: at least the local inscribed radius, padded so the circle also
    // covers a ring of neighbors (keeps thin strokes from needing 100s of circles).
    const r = Math.max(bestD, 1.5);
    circles.push({ gx: bx + 0.5, gy: by + 0.5, gr: r });

    const cover = r + 0.5; // honest: only cells the circle actually reaches
    const x0 = Math.max(0, Math.floor(bx - cover)), x1 = Math.min(gw - 1, Math.ceil(bx + cover));
    const y0 = Math.max(0, Math.floor(by - cover)), y1 = Math.min(gh - 1, Math.ceil(by + cover));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = y * gw + x;
        if (opaque[p] && !covered[p] && (x - bx) ** 2 + (y - by) ** 2 <= cover * cover) {
          covered[p] = 1;
          remaining--;
        }
      }
  }

  // Guarantee: if the cap was hit with cells still uncovered, grow the nearest
  // circle to reach each leftover cell. Conservative (extra spacing), never leaky.
  if (remaining > 0) {
    for (let p = 0; p < gw * gh; p++) {
      if (!opaque[p] || covered[p]) continue;
      const px = (p % gw) + 0.5, py = Math.floor(p / gw) + 0.5;
      let ni = 0, nd = Infinity;
      for (let i = 0; i < circles.length; i++) {
        const dd = (circles[i].gx - px) ** 2 + (circles[i].gy - py) ** 2;
        if (dd < nd) { nd = dd; ni = i; }
      }
      circles[ni].gr = Math.max(circles[ni].gr, Math.sqrt(nd) + 0.75);
    }
  }

  if (!circles.length) circles.push({ gx: gw / 2, gy: gh / 2, gr: Math.max(gw, gh) / 2 });

  // Convert to trimmed-source px relative to the canvas center. Pad each radius
  // by 3/4 of a cell so grid quantization (cell corners, chamfer-vs-euclidean
  // error) can never shave the true opaque edge.
  return circles.map((c) => ({
    x: c.gx * cell - w / 2,
    y: c.gy * cell - h / 2,
    r: (c.gr + 0.75) * cell,
  }));
}
