// packer.js — position logos inside an area mask by relaxation over their
// alpha-derived circle sets.
//
// Each node carries a set of collision circles (from the logo's opaque pixels,
// scaled to display size), so a wide wordmark collides along its full length
// while transparent corners of round logos stay usable as empty space.
//
// Forces per step:
//   1. Separation  — for each node pair, the deepest circle-vs-circle
//                    penetration (including padding) pushes the pair apart.
//   2. Containment — the area's distance field pushes any circle that pokes
//                    outside the shape back toward the interior.
//   3. Centripetal — a gentle pull toward the area centroid clusters logos in
//                    the middle and leaves empty space at the outer border.
// A final position-based resolution loop then removes any residual overlap so
// the model guarantees separation >= padding (within RESOLVE_TOL).
//
// node: { x?, y?, r, circles: [{dx, dy, r}] }   — all in canvas px.

export const RESOLVE_TOL = 0.5; // px; max allowed residual model penetration

export function pack(nodes, area, opts = {}) {
  const padding = opts.padding ?? 12;
  const borderClearance = opts.borderClearance ?? 0.5;
  const iterations = opts.iterations ?? 400;
  const n = nodes.length;
  if (!n) return nodes;

  const c = area.centroid;
  seed(nodes, area);

  // Centripetal strength: 0 → spread to fill; higher → tighter central cluster.
  const kCenter = 0.002 + borderClearance * 0.03;
  const borderPad = padding / 2;

  for (let it = 0; it < iterations; it++) {
    const cool = Math.max(0.25, 1 - it / (iterations * 1.2)); // anneal step size
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);

    // 1. pairwise separation (deepest-penetration push per pair)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const hit = deepestPenetration(nodes[i], nodes[j], padding);
        if (!hit) continue;
        const push = hit.depth / 2;
        fx[i] -= hit.ux * push; fy[i] -= hit.uy * push;
        fx[j] += hit.ux * push; fy[j] += hit.uy * push;
      }
    }

    // 2 + 3. containment and centripetal, then integrate
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      fx[i] += (c.x - nd.x) * kCenter;
      fy[i] += (c.y - nd.y) * kCenter;

      nd.x += fx[i] * cool;
      nd.y += fy[i] * cool;
      containNode(nd, area, borderPad, 1);
    }
  }

  resolve(nodes, area, padding);
  return nodes;
}

// Deterministic position-based solver: repeatedly fix the worst violation
// (pair penetration or containment) until everything satisfies the model.
export function resolve(nodes, area, padding, maxPasses = 600) {
  const borderPad = padding / 2;
  let bestWorst = Infinity, stuck = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    let worst = 0;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const hit = deepestPenetration(nodes[i], nodes[j], padding);
        if (!hit) continue;
        worst = Math.max(worst, hit.depth);
        const push = hit.depth / 2 + 0.05;
        nodes[i].x -= hit.ux * push; nodes[i].y -= hit.uy * push;
        nodes[j].x += hit.ux * push; nodes[j].y += hit.uy * push;
      }
    }
    for (const nd of nodes) worst = Math.max(worst, containNode(nd, area, borderPad, 4));

    if (worst <= RESOLVE_TOL) return { resolved: true, worst, passes: pass + 1 };

    // bail early when the layout is infeasible and progress has stalled —
    // the caller shrinks and retries, so grinding here is wasted time
    if (worst < bestWorst - 0.05) { bestWorst = worst; stuck = 0; }
    else if (++stuck >= 40) break;
  }
  return { resolved: false, worst: worstViolation(nodes, area, padding), passes: maxPasses };
}

// Largest remaining violation (pair penetration or containment deficit), px.
export function worstViolation(nodes, area, padding) {
  const borderPad = padding / 2;
  let worst = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const hit = deepestPenetration(nodes[i], nodes[j], padding);
      if (hit) worst = Math.max(worst, hit.depth);
    }
    for (const cc of nodes[i].circles) {
      const need = cc.r + borderPad;
      const deficit = need - area.distAt(nodes[i].x + cc.dx, nodes[i].y + cc.dy);
      if (deficit > worst) worst = deficit;
    }
  }
  return worst;
}

// Deepest circle-vs-circle penetration between two nodes, or null.
// Returns { depth, ux, uy } — unit vector points from a toward b.
function deepestPenetration(a, b, padding) {
  // broad phase: bounding circles
  const bdx = b.x - a.x, bdy = b.y - a.y;
  const bd = Math.hypot(bdx, bdy);
  if (bd >= a.r + b.r + padding) return null;

  let depth = 0, ux = 0, uy = 0;
  for (const ca of a.circles) {
    const ax = a.x + ca.dx, ay = a.y + ca.dy;
    for (const cb of b.circles) {
      const dx = b.x + cb.dx - ax;
      const dy = b.y + cb.dy - ay;
      const minD = ca.r + cb.r + padding;
      // cheap reject before sqrt: must beat the current deepest penetration
      const lim = minD - depth;
      if (lim <= 0) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= lim * lim) continue;
      const d = Math.sqrt(d2);
      depth = minD - d;
      if (d > 1e-4) { ux = dx / d; uy = dy / d; }
      else {
        // coincident circle centers — separate along the node axis (or x)
        const m = bd > 1e-4 ? bd : 1;
        ux = bd > 1e-4 ? bdx / m : 1;
        uy = bd > 1e-4 ? bdy / m : 0;
      }
    }
  }
  return depth > 0 ? { depth, ux, uy } : null;
}

// Push a node so its worst-offending circle sits inside the mask with
// `borderPad` clearance. Returns the remaining deficit after `steps` fixes.
function containNode(nd, area, borderPad, steps) {
  let deficit = 0;
  for (let s = 0; s < steps; s++) {
    let worst = 0, wx = 0, wy = 0, need = 0;
    for (const cc of nd.circles) {
      const cx = nd.x + cc.dx, cy = nd.y + cc.dy;
      const def = cc.r + borderPad - area.distAt(cx, cy);
      if (def > worst) { worst = def; wx = cx; wy = cy; need = def; }
    }
    deficit = worst;
    if (worst <= 0) return 0;
    const g = area.gradientAt(wx, wy);
    nd.x += g.x * need;
    nd.y += g.y * need;
  }
  return deficit;
}

// Seed positions: sunflower spiral around the centroid, snapped inside.
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
 * Suggest a base size (px, for a 100% logo's longest trimmed side) as the
 * starting point for the fit loop. Ratio of total opaque footprint (dilated by
 * half the padding) to mask area, assuming ~55% achievable packing density.
 * items: [{ maxSide, footprintRadius, scale }] in source px / percent.
 */
export function autoFitBaseSize(items, area, padding) {
  if (!items.length) return 160;
  const maskArea = area.mask.reduce((s, v) => s + v, 0) / (area.scale * area.scale);
  const PACK = 0.55;
  let coefB2 = 0, coefB1 = 0, coef0 = 0;
  const halfPad = padding / 2;
  for (const it of items) {
    const k = (it.footprintRadius * (it.scale / 100)) / it.maxSide;
    coefB2 += Math.PI * k * k;
    coefB1 += Math.PI * 2 * k * halfPad;
    coef0 += Math.PI * halfPad * halfPad;
  }
  const target = maskArea * PACK;
  const a = coefB2, b = coefB1, cc = coef0 - target;
  let B;
  if (a < 1e-9) B = 160;
  else {
    const disc = Math.max(0, b * b - 4 * a * cc);
    B = (-b + Math.sqrt(disc)) / (2 * a);
  }
  return Math.max(24, Math.min(600, Math.round(B)));
}
