// packer.js — position logos inside an area mask by relaxation over their
// alpha-derived circle sets.
//
// Each node carries a set of collision circles (from the logo's opaque pixels,
// scaled to display size), so a wide wordmark collides along its full length
// while transparent corners of round logos stay usable as empty space.
//
// Phases per pack():
//   1. Relax     — pairwise separation (deepest circle-vs-circle penetration
//                  plus padding) with a compaction pull toward the centroid
//                  that ANNEALS TO ZERO. Compaction gathers the set early;
//                  releasing it lets separation actually settle, so a failed
//                  pack means "genuinely doesn't fit" rather than "stalled".
//   2. Resolve   — deterministic position-based pass that removes residual
//                  overlap and pushes protruding circles back inside the mask,
//                  with seeded jitter to escape local minima.
//
// spread() then expands a settled layout into leftover space so gaps even out.
//
// node: { x?, y?, r, circles: [{dx, dy, r}] }   — all in canvas px.

export const RESOLVE_TOL = 0.5; // px; max allowed residual model penetration

// Small seeded PRNG so packs are reproducible run to run.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pack(nodes, area, opts = {}) {
  const padding = opts.padding ?? 12;
  const margin = opts.margin ?? 0;
  const iterations = opts.iterations ?? 300;
  const n = nodes.length;
  if (!n) return nodes;

  const rng = makeRng(opts.seed ?? 1);
  const c = area.centroid;
  if (opts.strategy === 'shelf') seedShelf(nodes, area, padding, margin);
  else seedPositions(nodes, area, rng);

  const kCenter0 = 0.05;
  for (let it = 0; it < iterations; it++) {
    const t = it / iterations;
    // Compaction is strong early and fully off by ~60% through the run.
    const kCenter = kCenter0 * Math.max(0, 1 - t / 0.6);
    const cool = Math.max(0.3, 1 - t);
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);

    let touched = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const hit = deepestPenetration(nodes[i], nodes[j], padding);
        if (!hit) continue;
        touched = true;
        const push = hit.depth / 2;
        fx[i] -= hit.ux * push; fy[i] -= hit.uy * push;
        fx[j] += hit.ux * push; fy[j] += hit.uy * push;
      }
    }

    let contained = true;
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      fx[i] += (c.x - nd.x) * kCenter;
      fy[i] += (c.y - nd.y) * kCenter;
      nd.x += fx[i] * cool;
      nd.y += fy[i] * cool;
      if (containNode(nd, area, margin, 1) > 0) contained = false;
    }

    // Settled with compaction already released — more iterations can't help.
    if (!touched && contained && kCenter === 0) break;
  }

  resolve(nodes, area, padding, margin, 500, rng);
  return nodes;
}

/**
 * Expand a settled layout so leftover space is shared out evenly: run the
 * separation pass against an inflated target gap, then re-settle at the true
 * padding. Restores the original layout if the expansion can't be re-resolved.
 */
export function spread(nodes, area, padding, target, opts = {}) {
  const margin = opts.margin ?? 0;
  const iterations = opts.iterations ?? 140;
  const rng = makeRng(opts.seed ?? 7);
  const snapshot = nodes.map((nd) => ({ x: nd.x, y: nd.y }));

  for (let it = 0; it < iterations; it++) {
    const cool = 0.5 * Math.max(0.25, 1 - it / iterations);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const hit = deepestPenetration(nodes[i], nodes[j], target);
        if (!hit) continue;
        const push = (hit.depth / 2) * cool;
        nodes[i].x -= hit.ux * push; nodes[i].y -= hit.uy * push;
        nodes[j].x += hit.ux * push; nodes[j].y += hit.uy * push;
      }
    }
    for (const nd of nodes) containNode(nd, area, margin, 2);
  }

  resolve(nodes, area, padding, margin, 400, rng);
  if (worstViolation(nodes, area, padding, margin) > RESOLVE_TOL) {
    nodes.forEach((nd, i) => { nd.x = snapshot[i].x; nd.y = snapshot[i].y; });
  }
  return nodes;
}

/**
 * Even out the spacing. Packing alone only guarantees "nothing overlaps", so
 * leftover room lands wherever the relaxation happened to stop — one pair ends
 * up nearly touching while another has a huge gap. This pass measures the
 * actual clearance between neighbouring logos and pulls every gap toward their
 * shared mean, which is what makes the padding read as consistent.
 *
 * Reverts to the incoming layout if the result can't be re-resolved, so it can
 * never introduce overlap.
 */
export function balance(nodes, area, padding, opts = {}) {
  const n = nodes.length;
  if (n < 3) return nodes;
  const margin = opts.margin ?? 0;
  const iterations = opts.iterations ?? 90;
  const neighbours = opts.neighbours ?? 3;
  const rng = makeRng(opts.seed ?? 11);
  const snapshot = nodes.map((nd) => ({ x: nd.x, y: nd.y }));

  for (let it = 0; it < iterations; it++) {
    // Nearest-neighbour graph, rebuilt each step since positions move.
    const pairs = [];
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const gaps = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const s = separation(nodes[i], nodes[j]);
        if (s.gap < Infinity) gaps.push({ j, ...s });
      }
      gaps.sort((a, b) => a.gap - b.gap);
      for (const g of gaps.slice(0, neighbours)) {
        const key = i < g.j ? `${i}:${g.j}` : `${g.j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ i, j: g.j, gap: g.gap, ux: g.ux, uy: g.uy });
      }
    }
    if (!pairs.length) break;

    const mean = pairs.reduce((s, p) => s + p.gap, 0) / pairs.length;
    const target = Math.max(padding, mean);
    const step = 0.25 * Math.max(0.3, 1 - it / iterations);

    for (const p of pairs) {
      // positive error = too far apart, pull together; negative = push apart
      const err = (p.gap - target) * step * 0.5;
      nodes[p.i].x += p.ux * err; nodes[p.i].y += p.uy * err;
      nodes[p.j].x -= p.ux * err; nodes[p.j].y -= p.uy * err;
    }
    for (const nd of nodes) containNode(nd, area, margin, 2);
  }

  resolve(nodes, area, padding, margin, 400, rng);
  if (worstViolation(nodes, area, padding, margin) > RESOLVE_TOL) {
    nodes.forEach((nd, i) => { nd.x = snapshot[i].x; nd.y = snapshot[i].y; });
    return nodes;
  }
  return nodes;
}

/**
 * Closest clearance between two nodes' footprints: min over circle pairs of
 * (centre distance - both radii). Negative means they interpenetrate.
 * ux/uy is the unit vector from a toward b along that closest pair.
 */
export function separation(a, b) {
  let best = Infinity, ux = 0, uy = 0;
  const ga = clustersOf(a), gb = clustersOf(b);
  for (const ca of ga) {
    const gax = a.x + ca.cx, gay = a.y + ca.cy;
    for (const cbG of gb) {
      const gdx = b.x + cbG.cx - gax, gdy = b.y + cbG.cy - gay;
      // cluster clearance lower bound — skip if it can't beat the best so far
      if (Math.hypot(gdx, gdy) - ca.r - cbG.r >= best) continue;
      for (const cA of ca.items) {
        const ax = a.x + cA.dx, ay = a.y + cA.dy;
        for (const cB of cbG.items) {
          const dx = b.x + cB.dx - ax, dy = b.y + cB.dy - ay;
          const d = Math.hypot(dx, dy);
          const s = d - cA.r - cB.r;
          if (s < best) {
            best = s;
            if (d > 1e-4) { ux = dx / d; uy = dy / d; }
          }
        }
      }
    }
  }
  return { gap: best, ux, uy };
}

// Deterministic position-based solver: repeatedly fix the worst violation
// (pair penetration or containment) until everything satisfies the model.
export function resolve(nodes, area, padding, margin = 0, maxPasses = 500, rng = makeRng(3)) {
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
    for (const nd of nodes) worst = Math.max(worst, containNode(nd, area, margin, 4));

    if (worst <= RESOLVE_TOL) return { resolved: true, worst, passes: pass + 1 };

    if (worst < bestWorst - 0.05) { bestWorst = worst; stuck = 0; }
    else if (++stuck >= 25) {
      // Nudge everything slightly to escape a local minimum, then keep going.
      // Only a genuinely infeasible layout should survive several of these.
      stuck = 0;
      if (pass > maxPasses * 0.75) break;
      for (const nd of nodes) {
        nd.x += (rng() - 0.5) * padding;
        nd.y += (rng() - 0.5) * padding;
        containNode(nd, area, margin, 3);
      }
    }
  }
  return { resolved: false, worst: worstViolation(nodes, area, padding, margin), passes: maxPasses };
}

// Largest remaining violation (pair penetration or containment deficit), px.
export function worstViolation(nodes, area, padding, margin = 0) {
  let worst = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const hit = deepestPenetration(nodes[i], nodes[j], padding);
      if (hit) worst = Math.max(worst, hit.depth);
    }
    for (const cc of nodes[i].circles) {
      const need = cc.r + margin;
      const deficit = need - area.distAt(nodes[i].x + cc.dx, nodes[i].y + cc.dy);
      if (deficit > worst) worst = deficit;
    }
  }
  return worst;
}

// Group a node's circles into bounding clusters so most circle-pair tests can
// be skipped wholesale. A wide wordmark has ~50 circles strung along its
// length; without this, every node pair costs 50x50 distance tests per
// iteration, which dominates runtime once there are 15+ logos.
const CLUSTER_SIZE = 8;
function clustersOf(nd) {
  if (nd._clusters) return nd._clusters;
  const cs = nd.circles;
  if (cs.length <= CLUSTER_SIZE + 2) {
    nd._clusters = [{ cx: 0, cy: 0, r: nd.r, items: cs }];
    return nd._clusters;
  }
  // Split along the logo's longer axis so clusters are compact and disjoint.
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const c of cs) {
    minx = Math.min(minx, c.dx); maxx = Math.max(maxx, c.dx);
    miny = Math.min(miny, c.dy); maxy = Math.max(maxy, c.dy);
  }
  const byX = maxx - minx >= maxy - miny;
  const sorted = cs.slice().sort((p, q) => (byX ? p.dx - q.dx : p.dy - q.dy));

  const groups = [];
  for (let i = 0; i < sorted.length; i += CLUSTER_SIZE) {
    const items = sorted.slice(i, i + CLUSTER_SIZE);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of items) {
      x0 = Math.min(x0, c.dx - c.r); x1 = Math.max(x1, c.dx + c.r);
      y0 = Math.min(y0, c.dy - c.r); y1 = Math.max(y1, c.dy + c.r);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let r = 0;
    for (const c of items) r = Math.max(r, Math.hypot(c.dx - cx, c.dy - cy) + c.r);
    groups.push({ cx, cy, r, items });
  }
  nd._clusters = groups;
  return groups;
}

// Deepest circle-vs-circle penetration between two nodes, or null.
// Returns { depth, ux, uy } — unit vector points from a toward b.
function deepestPenetration(a, b, padding) {
  // broad phase: bounding circles (axis check first — cheaper than hypot)
  const bdx = b.x - a.x, bdy = b.y - a.y;
  const reach = a.r + b.r + padding;
  if (bdx > reach || bdx < -reach || bdy > reach || bdy < -reach) return null;
  const bd2 = bdx * bdx + bdy * bdy;
  if (bd2 >= reach * reach) return null;
  const bd = Math.sqrt(bd2);

  let depth = 0, ux = 0, uy = 0;
  const ga = clustersOf(a), gb = clustersOf(b);
  for (const ca of ga) {
    const gax = a.x + ca.cx, gay = a.y + ca.cy;
    for (const cbG of gb) {
      // mid phase: skip whole clusters that cannot beat the current best
      const gdx = b.x + cbG.cx - gax, gdy = b.y + cbG.cy - gay;
      const gReach = ca.r + cbG.r + padding - depth;
      if (gReach <= 0) continue;
      if (gdx * gdx + gdy * gdy >= gReach * gReach) continue;

      for (const cA of ca.items) {
        const ax = a.x + cA.dx, ay = a.y + cA.dy;
        for (const cB of cbG.items) {
          const dx = b.x + cB.dx - ax;
          const dy = b.y + cB.dy - ay;
          const minD = cA.r + cB.r + padding;
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
    }
  }
  return depth > 0 ? { depth, ux, uy } : null;
}

// Push a node so its worst-offending circle sits inside the mask with `margin`
// clearance. Returns the remaining deficit after `steps` fixes.
function containNode(nd, area, margin, steps) {
  let deficit = 0;
  for (let s = 0; s < steps; s++) {
    let worst = 0, wx = 0, wy = 0;
    for (const cc of nd.circles) {
      const cx = nd.x + cc.dx, cy = nd.y + cc.dy;
      const def = cc.r + margin - area.distAt(cx, cy);
      if (def > worst) { worst = def; wx = cx; wy = cy; }
    }
    deficit = worst;
    if (worst <= 0) return 0;
    const g = area.gradientAt(wx, wy);
    nd.x += g.x * worst;
    nd.y += g.y * worst;
  }
  return deficit;
}

// Seed positions: sunflower spiral around the centroid, snapped inside.
function seedPositions(nodes, area, rng) {
  const c = area.centroid;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spreadR = area.maxDist * 0.9;
  nodes.forEach((nd, i) => {
    if (typeof nd.x === 'number' && typeof nd.y === 'number' && area.inside(nd.x, nd.y)) return;
    const t = (i + 0.5) / nodes.length;
    const rad = Math.sqrt(t) * spreadR;
    const ang = i * golden + rng() * 0.4;
    let x = c.x + Math.cos(ang) * rad;
    let y = c.y + Math.sin(ang) * rad;
    // Fall back to a guaranteed-interior point, never to a spot that might sit
    // in a hole (a donut mask's centre is outside the fillable region).
    if (!area.inside(x, y)) { const a = area.anchor || c; x = a.x; y = a.y; }
    nd.x = x;
    nd.y = y;
  });
}

// Shelf seeding: lay nodes out in rows, tallest first, wrapping at the area's
// width. Sponsor sets are mostly wide, short wordmarks, which stack into rows
// far more tightly than a spiral does — relaxation then refines from there.
function seedShelf(nodes, area, padding, margin) {
  const order = nodes.map((n, i) => i).sort((a, b) => nodes[b].displayH - nodes[a].displayH);
  const usableW = Math.max(1, area.width - margin * 2);
  // Rows are centred on this; it must be a point inside the shape.
  const origin = area.inside(area.centroid.x, area.centroid.y)
    ? area.centroid
    : (area.anchor || area.centroid);
  const rows = [];
  let row = { items: [], w: 0, h: 0 };
  for (const i of order) {
    const nd = nodes[i];
    const w = nd.displayW || nd.r * 2;
    const h = nd.displayH || nd.r * 2;
    const add = row.items.length ? padding + w : w;
    if (row.items.length && row.w + add > usableW) {
      rows.push(row);
      row = { items: [], w: 0, h: 0 };
    }
    row.w += row.items.length ? padding + w : w;
    row.h = Math.max(row.h, h);
    row.items.push({ i, w, h });
  }
  if (row.items.length) rows.push(row);

  const totalH = rows.reduce((s, r) => s + r.h, 0) + padding * Math.max(0, rows.length - 1);
  let y = origin.y - totalH / 2;
  for (const r of rows) {
    let x = origin.x - r.w / 2;
    for (const it of r.items) {
      nodes[it.i].x = x + it.w / 2;
      nodes[it.i].y = y + r.h / 2;
      x += it.w + padding;
    }
    y += r.h + padding;
  }
}

/**
 * Rough starting guess for the size search: ratio of total opaque footprint
 * (dilated by half the padding) to mask area at ~60% achievable density.
 * items: [{ maxSide, footprintRadius, scale }] in source px / percent.
 */
export function autoFitBaseSize(items, area, padding) {
  if (!items.length) return 160;
  const maskArea = area.mask.reduce((s, v) => s + v, 0) / (area.scale * area.scale);
  const PACK = 0.6;
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
  if (a < 1e-9) return 160;
  const disc = Math.max(0, b * b - 4 * a * cc);
  return Math.max(8, Math.round((-b + Math.sqrt(disc)) / (2 * a)));
}
