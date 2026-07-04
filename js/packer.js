// packer.js — position logos inside an area mask by relaxation.
//
// Each node is a circle of radius `r` (the logo's alpha footprint at display
// scale). Three forces run each step:
//   1. Repulsion  — overlapping footprints (plus shared padding) push apart,
//                    giving even interior spacing.
//   2. Containment — the distance field pushes any node whose footprint pokes
//                    outside the shape back toward the interior.
//   3. Centripetal — a gentle pull toward the area centroid clusters logos in
//                    the middle and leaves empty space at the outer border.
//
// nodes: [{ r, x?, y? }]  — r in canvas px. x/y seeded if absent.
// opts:  { padding, borderClearance (0..1), iterations }

export function pack(nodes, area, opts = {}) {
  const padding = opts.padding ?? 12;
  const borderClearance = opts.borderClearance ?? 0.5;
  const iterations = opts.iterations ?? 500;
  const n = nodes.length;
  if (!n) return nodes;

  const c = area.centroid;
  seed(nodes, area);

  // Centripetal strength: 0 → spread to fill; higher → tighter central cluster.
  const kCenter = 0.002 + borderClearance * 0.03;
  const half = padding / 2;

  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / (iterations * 1.4); // anneal step size
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);

    // 1. pairwise repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let d = Math.hypot(dx, dy);
        const minD = nodes[i].r + nodes[j].r + padding;
        if (d < 1e-4) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d = 1; }
        if (d < minD) {
          const push = (minD - d) / 2;
          const ux = dx / d, uy = dy / d;
          fx[i] -= ux * push; fy[i] -= uy * push;
          fx[j] += ux * push; fy[j] += uy * push;
        }
      }
    }

    // 2 + 3. containment and centripetal, then integrate
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      // centripetal pull toward centroid
      fx[i] += (c.x - nd.x) * kCenter;
      fy[i] += (c.y - nd.y) * kCenter;

      let nx = nd.x + fx[i] * cool;
      let ny = nd.y + fy[i] * cool;

      // containment: keep the footprint (plus a hair of padding) inside
      const need = nd.r + half;
      const dist = area.distAt(nx, ny);
      if (dist < need) {
        const g = area.gradientAt(nx, ny);
        const push = (need - dist);
        nx += g.x * push;
        ny += g.y * push;
      }
      nd.x = nx;
      nd.y = ny;
    }
  }

  // final hard clamp: nudge any stragglers back inside
  for (const nd of nodes) {
    let guard = 0;
    while (area.distAt(nd.x, nd.y) < nd.r * 0.6 && guard++ < 24) {
      const g = area.gradientAt(nd.x, nd.y);
      nd.x += g.x * (nd.r * 0.6);
      nd.y += g.y * (nd.r * 0.6);
      if (!area.inside(nd.x, nd.y)) { nd.x = c.x; nd.y = c.y; }
    }
  }
  return nodes;
}

// Seed positions: sunflower spiral around the centroid, biggest first, each
// snapped to a point that is actually inside the mask.
function seed(nodes, area) {
  const c = area.centroid;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spread = area.maxDist * 0.9;
  nodes.forEach((nd, i) => {
    if (typeof nd.x === 'number' && typeof nd.y === 'number' && area.inside(nd.x, nd.y)) return;
    const t = (i + 0.5) / nodes.length;
    const rad = Math.sqrt(t) * spread;
    const ang = i * golden;
    let x = c.x + Math.cos(ang) * rad;
    let y = c.y + Math.sin(ang) * rad;
    if (!area.inside(x, y)) { x = c.x; y = c.y; }
    nd.x = x;
    nd.y = y;
  });
}

/**
 * Suggest a base size (px, for a 100% logo's longest trimmed side) that lets
 * the whole set fit inside the area with the given padding. Uses the ratio of
 * total footprint area to mask area, assuming ~62% achievable circle packing.
 * items: [{ maxSide, footprintRadius, scale }] in source px / percent.
 */
export function autoFitBaseSize(items, area, padding) {
  if (!items.length) return 160;
  // Estimate usable mask area in logical px^2.
  const maskArea = area.mask.reduce((s, v) => s + v, 0) / (area.scale * area.scale);
  const PACK = 0.62;
  // For a candidate base B: displayScale_i = (B/maxSide_i)*(scale_i/100);
  // footprint radius (px) = footprintRadius_i * displayScale_i (+ padding/2).
  // Total occupied ≈ Σ π (r_i + pad/2)^2. Solve for B by evaluating the
  // dimensionless coefficient of B^2 and matching to maskArea*PACK.
  let coefB2 = 0; // Σ π (fr_i * (scale/100) / maxSide_i)^2
  let coefB1 = 0; // Σ π * 2 * (fr_i...) * (pad/2)
  let coef0 = 0;  // Σ π (pad/2)^2
  const halfPad = padding / 2;
  for (const it of items) {
    const k = (it.footprintRadius * (it.scale / 100)) / it.maxSide;
    coefB2 += Math.PI * k * k;
    coefB1 += Math.PI * 2 * k * halfPad;
    coef0 += Math.PI * halfPad * halfPad;
  }
  const target = maskArea * PACK;
  // Solve coefB2 * B^2 + coefB1 * B + (coef0 - target) = 0 for B.
  const a = coefB2, b = coefB1, cc = coef0 - target;
  let B;
  if (a < 1e-9) B = 160;
  else {
    const disc = Math.max(0, b * b - 4 * a * cc);
    B = (-b + Math.sqrt(disc)) / (2 * a);
  }
  return Math.max(24, Math.min(600, Math.round(B)));
}
