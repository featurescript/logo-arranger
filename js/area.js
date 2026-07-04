// area.js — turn any 2D area definition (preset shape, polygon, or uploaded
// mask image) into a binary mask plus a distance field. The distance field
// (distance from each interior point to the nearest border) is what lets the
// packer keep logos inside the shape and push empty space to the outer border.

const MAX_GRID = 480; // cap the longest mask side for a fast distance transform
const ALPHA_THRESHOLD = 12;

/**
 * spec = {
 *   type: 'rect'|'circle'|'ellipse'|'polygon'|'mask',
 *   width, height,             // logical area size (canvas px)
 *   polygon?: [{x,y}, ...],    // logical coords, for type 'polygon'
 *   maskCanvas?: HTMLCanvasElement  // for type 'mask'
 * }
 */
export function buildArea(spec) {
  const { width, height } = spec;
  const long = Math.max(width, height);
  const scale = Math.min(1, MAX_GRID / long); // grid px per logical px
  const gw = Math.max(2, Math.round(width * scale));
  const gh = Math.max(2, Math.round(height * scale));

  const mask = new Uint8Array(gw * gh);
  fillMask(mask, gw, gh, spec, scale);

  const dist = distanceTransform(mask, gw, gh); // grid-unit distance to outside

  const invScale = 1 / scale;
  const area = {
    type: spec.type,
    width,
    height,
    gw,
    gh,
    scale,
    mask,
    dist,
    polygon: spec.polygon,
    maskCanvas: spec.maskCanvas,

    // logical coords -> is inside the shape
    inside(x, y) {
      const gx = Math.floor(x * scale);
      const gy = Math.floor(y * scale);
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
      return mask[gy * gw + gx] === 1;
    },

    // distance from (x,y) to the nearest border, in logical px (0 outside)
    distAt(x, y) {
      const gx = x * scale;
      const gy = y * scale;
      return sampleBilinear(dist, gw, gh, gx, gy) * invScale;
    },

    // unit vector pointing toward the interior (uphill of the distance field)
    gradientAt(x, y) {
      const gx = x * scale;
      const gy = y * scale;
      const dx = sampleBilinear(dist, gw, gh, gx + 1, gy) - sampleBilinear(dist, gw, gh, gx - 1, gy);
      const dy = sampleBilinear(dist, gw, gh, gx, gy + 1) - sampleBilinear(dist, gw, gh, gx, gy - 1);
      const m = Math.hypot(dx, dy) || 1;
      return { x: dx / m, y: dy / m };
    },
  };

  area.centroid = computeCentroid(mask, gw, gh, invScale);
  area.maxDist = maxOf(dist) * invScale;
  return area;
}

function fillMask(mask, gw, gh, spec, scale) {
  const { type, width, height } = spec;
  if (type === 'mask' && spec.maskCanvas) {
    fillFromImage(mask, gw, gh, spec.maskCanvas);
    return;
  }
  if (type === 'polygon' && spec.polygon && spec.polygon.length >= 3) {
    const pts = spec.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++)
        if (pointInPolygon(x + 0.5, y + 0.5, pts)) mask[y * gw + x] = 1;
    return;
  }
  // preset shapes
  const cx = gw / 2, cy = gh / 2;
  const rx = gw / 2, ry = gh / 2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let inside = false;
      if (type === 'circle') {
        const r = Math.min(rx, ry);
        inside = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
      } else if (type === 'ellipse') {
        inside = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
      } else {
        inside = true; // rect
      }
      if (inside) mask[y * gw + x] = 1;
    }
  }
}

function fillFromImage(mask, gw, gh, srcCanvas) {
  const tmp = document.createElement('canvas');
  tmp.width = gw;
  tmp.height = gh;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0, gw, gh);
  const data = ctx.getImageData(0, 0, gw, gh).data;
  // Detect whether the image carries meaningful transparency.
  let transparentCount = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] <= ALPHA_THRESHOLD) transparentCount++;
  const useAlpha = transparentCount > gw * gh * 0.01;
  for (let p = 0; p < gw * gh; p++) {
    const a = data[p * 4 + 3];
    if (useAlpha) {
      mask[p] = a > ALPHA_THRESHOLD ? 1 : 0;
    } else {
      // Opaque image: treat non-near-white pixels as the fillable region.
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      mask[p] = (r + g + b) / 3 < 245 ? 1 : 0;
    }
  }
}

// Two-pass chamfer distance transform. Returns distance (grid units) from each
// interior cell to the nearest exterior cell; exterior cells are 0.
function distanceTransform(mask, gw, gh) {
  const INF = 1e9;
  const d = new Float32Array(gw * gh);
  const A = 1, B = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;

  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x]);
  // forward
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!mask[y * gw + x]) continue;
      let v = d[y * gw + x];
      v = Math.min(v, at(x - 1, y) + A, at(x, y - 1) + A, at(x - 1, y - 1) + B, at(x + 1, y - 1) + B);
      d[y * gw + x] = v;
    }
  }
  // backward
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      if (!mask[y * gw + x]) continue;
      let v = d[y * gw + x];
      v = Math.min(v, at(x + 1, y) + A, at(x, y + 1) + A, at(x + 1, y + 1) + B, at(x - 1, y + 1) + B);
      d[y * gw + x] = v;
    }
  }
  return d;
}

function sampleBilinear(field, gw, gh, x, y) {
  x = Math.max(0, Math.min(gw - 1, x));
  y = Math.max(0, Math.min(gh - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = field[y0 * gw + x0], b = field[y0 * gw + x1];
  const c = field[y1 * gw + x0], e = field[y1 * gw + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + e * fx * fy;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function computeCentroid(mask, gw, gh, invScale) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (mask[y * gw + x]) { sx += x; sy += y; n++; }
  if (!n) return { x: (gw / 2) * invScale, y: (gh / 2) * invScale };
  return { x: (sx / n) * invScale, y: (sy / n) * invScale };
}

function maxOf(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}
