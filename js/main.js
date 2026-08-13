// main.js — wires the UI to the area builder, packer, and renderer.
import { loadLogo } from './logo.js';
import { buildArea } from './area.js';
import { pack, spread, balance, autoFitBaseSize, worstViolation, RESOLVE_TOL } from './packer.js';
import { draw, hitTest, eventToCanvas, exportPNG } from './render.js';

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const state = {
  logos: [],            // logo descriptors (see logo.js)
  nodes: new Map(),     // logo.id -> { x, y } persisted positions
  placed: [],           // render list
  area: null,
  spec: { type: 'rect', width: 1200, height: 800, polygon: [], maskCanvas: null },
  polyClosed: false,
  drag: null,
  seed: 1,
  effectiveBase: 0,
  tiers: [
    { id: 'tier-p', name: 'Platinum', pct: 300, color: '#c6d4e8' },
    { id: 'tier-g', name: 'Gold', pct: 200, color: '#e3b341' },
    { id: 'tier-s', name: 'Silver', pct: 150, color: '#a9b1bd' },
    { id: 'tier-b', name: 'Bronze', pct: 100, color: '#cd7f4b' },
  ],
};
let tierSeq = 0;

// The default tier for newly added logos: the smallest %, i.e. the base tier.
function defaultTier() {
  return state.tiers.reduce((lo, t) => (t.pct < lo.pct ? t : lo), state.tiers[0]);
}
function tierOf(logo) {
  return state.tiers.find((t) => t.id === logo.tierId) || defaultTier();
}

// ---------------- Area ----------------
function rebuildArea() {
  const s = state.spec;
  canvas.width = s.width;
  canvas.height = s.height;
  // Polygon that isn't closed yet: skip building a mask; show draft only.
  if (s.type === 'polygon' && !state.polyClosed) {
    state.area = null;
    redraw();
    return;
  }
  state.area = buildArea(s);
  redraw();
}

function setAreaType(type) {
  state.spec.type = type;
  document.querySelectorAll('[data-area-group]').forEach((el) => {
    const g = el.getAttribute('data-area-group');
    const show =
      (g === 'dims' && (type === 'rect' || type === 'circle' || type === 'ellipse')) ||
      (g === 'polygon' && type === 'polygon') ||
      (g === 'mask' && type === 'mask');
    el.hidden = !show;
  });
  if (type === 'polygon') { state.spec.polygon = []; state.polyClosed = false; }
  rebuildArea();
}

// ---------------- Logos ----------------
async function addLogoFiles(files) {
  for (const f of files) {
    try {
      const logo = await loadLogo(f);
      state.logos.push(logo);
    } catch (e) {
      console.error(e);
    }
  }
  renderLogoList();
  arrange(); // arrange immediately so new logos never sit unplaced
}

function renderLogoList() {
  const list = $('logoList');
  list.innerHTML = '';
  $('logoEmpty').hidden = state.logos.length > 0;
  state.logos.forEach((logo) => {
    const li = document.createElement('li');
    li.className = 'logo-item';

    const thumb = document.createElement('canvas');
    thumb.className = 'logo-thumb';
    thumb.width = 34; thumb.height = 34;
    fitThumb(thumb.getContext('2d'), logo.canvas, 34);

    const name = document.createElement('span');
    name.className = 'logo-name';
    name.textContent = logo.name;
    name.title = logo.name;

    const tier = tierOf(logo);
    logo.tierId = tier.id;
    const tierPick = document.createElement('select');
    tierPick.className = 'logo-tier';
    tierPick.style.borderColor = tier.color;
    state.tiers.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${t.name} · ${t.pct}%`;
      if (t.id === logo.tierId) o.selected = true;
      tierPick.appendChild(o);
    });
    tierPick.addEventListener('change', () => {
      logo.tierId = tierPick.value;
      tierPick.style.borderColor = tierOf(logo).color;
      arrange();
    });

    const del = document.createElement('button');
    del.className = 'logo-del';
    del.innerHTML = '&times;';
    del.title = 'Remove';
    del.addEventListener('click', () => {
      state.logos = state.logos.filter((l) => l !== logo);
      state.nodes.delete(logo.id);
      renderLogoList();
      arrange();
    });

    li.append(thumb, name, tierPick, del);
    list.appendChild(li);
  });
}

// ---------------- Tier editor ----------------
function renderTierList() {
  const list = $('tierList');
  list.innerHTML = '';
  state.tiers.forEach((tier) => {
    const li = document.createElement('li');
    li.className = 'tier-item';

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'tier-color';
    swatch.value = tier.color;
    swatch.title = 'Tier colour';
    swatch.addEventListener('input', () => { tier.color = swatch.value; renderLogoList(); });

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'tier-name';
    name.value = tier.name;
    name.addEventListener('change', () => {
      tier.name = name.value.trim() || 'Tier';
      name.value = tier.name;
      renderLogoList();
    });

    const pctWrap = document.createElement('span');
    pctWrap.className = 'tier-pct';
    const pct = document.createElement('input');
    pct.type = 'number';
    pct.min = '10'; pct.max = '1000'; pct.step = '10';
    pct.value = tier.pct;
    pct.addEventListener('change', () => {
      tier.pct = Math.max(10, Math.min(1000, Number(pct.value) || 100));
      pct.value = tier.pct;
      renderLogoList();
      arrange();
    });
    pctWrap.append(pct, document.createTextNode('%'));

    const del = document.createElement('button');
    del.className = 'logo-del';
    del.innerHTML = '&times;';
    del.title = 'Remove tier';
    del.disabled = state.tiers.length <= 1;
    del.addEventListener('click', () => {
      if (state.tiers.length <= 1) return;
      state.tiers = state.tiers.filter((t) => t !== tier);
      // Reassign any logos that pointed at the removed tier.
      const fallback = defaultTier();
      state.logos.forEach((l) => { if (l.tierId === tier.id) l.tierId = fallback.id; });
      renderTierList();
      renderLogoList();
      arrange();
    });

    li.append(swatch, name, pctWrap, del);
    list.appendChild(li);
  });
}

$('addTier').addEventListener('click', () => {
  state.tiers.push({
    id: `tier-new-${tierSeq++}`,
    name: `Tier ${state.tiers.length + 1}`,
    pct: 100,
    color: '#7c8aa5',
  });
  renderTierList();
  renderLogoList();
});

function fitThumb(c, src, box) {
  const s = Math.min(box / src.width, box / src.height);
  const w = src.width * s, h = src.height * s;
  c.drawImage(src, (box - w) / 2, (box - h) / 2, w, h);
}

// ---------------- Layout / pack ----------------
function computeNodes(baseSize) {
  const mode = $('sizeMode').value;
  return state.logos.map((logo) => {
    const maxSide = Math.max(logo.w, logo.h);
    const k = tierOf(logo).pct / 100;
    let ds;
    if (mode === 'area') {
      // Scale so every logo at the same tier covers the same INK area. A wide
      // wordmark and a round badge then read as equally prominent, instead of
      // the badge dominating just because its bounding box is square.
      const inkArea = Math.max(1, logo.opaqueFrac * logo.w * logo.h);
      ds = (baseSize * k) / Math.sqrt(inkArea);
      // Guard against absurd geometry only — a hairline logo has almost no ink
      // area, so equal-ink scaling alone would stretch it past the canvas. Cap
      // by the area's own size rather than the base, otherwise wide wordmarks
      // get throttled below their fair share and the tier bias returns.
      const maxAllowed = Math.max(state.area.width, state.area.height) * 0.98;
      ds = Math.min(ds, maxAllowed / maxSide);
    } else {
      ds = (baseSize / maxSide) * k;
    }
    const prev = state.nodes.get(logo.id);
    return {
      logo,
      r: logo.boundRadius * ds,
      circles: logo.circles.map((c) => ({ dx: c.x * ds, dy: c.y * ds, r: c.r * ds })),
      displayW: logo.w * ds,
      displayH: logo.h * ds,
      x: prev?.x,
      y: prev?.y,
    };
  });
}

const DEFAULT_HINT = 'Drag any logo to nudge it. Re-run “Arrange” to reflow.';
function setHint(msg) { $('stageHint').textContent = msg; }

const FIT_TOL = RESOLVE_TOL + 0.4;
const SEARCH_ITER = 260; // relaxation steps while searching for the size
const FINAL_ITER = 460;  // steps for the winning size

// Pack at `base`, trying several starting layouts. Relaxation only finds a
// local optimum, so a single failed attempt does NOT mean the size is too big —
// retrying from a different seed routinely succeeds where one attempt failed.
// Returns as soon as an attempt fits, else the closest near-miss.
function attempt(base, padding, margin, iterations, seed, tries = 3) {
  const plans = [
    { strategy: 'shelf', seed },
    { strategy: 'spiral', seed },
    { strategy: 'spiral', seed: seed + 977 },
    { strategy: 'shelf', seed: seed + 331 },
  ].slice(0, Math.max(1, tries));

  let bestMiss = null;
  for (const plan of plans) {
    state.nodes.clear(); // always start this attempt from the chosen seeding
    const nodes = computeNodes(base);
    pack(nodes, state.area, { padding, margin, iterations, ...plan });
    const worst = worstViolation(nodes, state.area, padding, margin);
    if (worst <= FIT_TOL) return { nodes, base, worst, ok: true };
    if (!bestMiss || worst < bestMiss.worst) bestMiss = { nodes, base, worst, ok: false };
  }
  return bestMiss;
}

// Find the LARGEST size that packs cleanly: grow while it fits, then bisect
// between the last size that fit and the first that didn't. Growing is the
// whole point — a size that fits easily should be pushed up until the area is
// actually full, not accepted as-is.
function repack() {
  if (!state.area || !state.logos.length) { state.placed = []; redraw(); return; }
  const padding = Number($('padding').value);
  const margin = Number($('edgeMargin').value);
  const cap = Number($('baseSize').value); // user-set upper bound
  const seed = state.seed;

  const estimate = startingEstimate(padding);

  let lo = null;                             // largest size known to fit
  let hi = null;                             // smallest size known to fail
  let probe = Math.min(cap, Math.max(12, estimate));
  let best = null;

  // Phase 1: bracket. Grow while it fits (up to the cap), shrink while it doesn't.
  for (let t = 0; t < 9; t++) {
    const r = attempt(probe, padding, margin, SEARCH_ITER, seed);
    if (r.ok) {
      if (!best || r.base > best.base) best = r;
      lo = r.base;
      if (probe >= cap) break;               // capped by the user's max
      probe = Math.min(cap, Math.round(probe * 1.45));
      if (lo >= cap) break;
    } else {
      hi = r.base;
      if (lo !== null) break;                // bracketed: lo fits, hi fails
      probe = Math.round(probe * 0.7);
      if (probe < 12) break;
    }
  }

  // Phase 2: bisect the bracket to squeeze out the remaining headroom.
  if (lo !== null && hi !== null) {
    for (let t = 0; t < 7 && hi - lo > Math.max(2, lo * 0.015); t++) {
      const mid = Math.round((lo + hi) / 2);
      const r = attempt(mid, padding, margin, SEARCH_ITER, seed, 3);
      if (r.ok) { lo = mid; best = r; } else { hi = mid; }
    }
  }

  if (!best) {
    // Nothing fits, even at the floor — say so instead of drawing overlap.
    best = attempt(12, padding, margin, FINAL_ITER, seed);
    state.effectiveBase = best.base; // don't leave a stale size from a prior run
    state.placed = best.nodes;
    best.nodes.forEach((n) => state.nodes.set(n.logo.id, { x: n.x, y: n.y }));
    setHint('Area too small for this logo set — enlarge the area or reduce padding.');
    redraw();
    return;
  }

  // Phase 3: re-pack the winner at full quality, then even out the gaps.
  let finalRun = attempt(best.base, padding, margin, FINAL_ITER, seed, 4);
  if (!finalRun.ok) finalRun = best; // keep the search result if the retry regressed
  const nodes = finalRun.nodes;

  // Push into leftover space so gaps even out. Try the most aggressive target
  // first and fall back — spread() restores its snapshot if a target can't be
  // re-resolved, so an over-ambitious attempt costs time, never correctness.
  const meanR = nodes.reduce((s, n) => s + n.r, 0) / nodes.length;
  for (const k of [1.4, 0.8, 0.4]) {
    const before = nodes.map((n) => ({ x: n.x, y: n.y }));
    spread(nodes, state.area, padding, padding + meanR * k, { margin, seed, iterations: 170 });
    if (nodes.some((n, i) => n.x !== before[i].x || n.y !== before[i].y)) break;
  }
  // Then even the gaps out — spreading fills the space, balancing makes the
  // spacing look deliberate rather than wherever the solver happened to stop.
  balance(nodes, state.area, padding, { margin, seed, iterations: 90 });

  state.effectiveBase = finalRun.base;
  const fill = coveragePercent(nodes);
  setHint(
    finalRun.base >= cap
      ? `Logo size ${finalRun.base}px (at your max) · ${fill}% of the area filled.`
      : `Logo size ${finalRun.base}px — largest that fits · ${fill}% of the area filled.`,
  );

  nodes.forEach((n) => state.nodes.set(n.logo.id, { x: n.x, y: n.y }));
  state.placed = nodes;
  redraw();
}

// Where to begin the size search. Only a starting point — the grow/bisect
// search corrects a bad guess, it just costs an extra probe or two.
function startingEstimate(padding) {
  if ($('sizeMode').value === 'area') {
    // ink_i = (base * k_i)^2, so base = sqrt(usable / sum(k^2)).
    let areaPx = 0;
    for (const v of state.area.mask) areaPx += v;
    areaPx /= state.area.scale * state.area.scale;
    const sumK2 = state.logos.reduce((s, l) => s + (tierOf(l).pct / 100) ** 2, 0);
    if (!sumK2 || !areaPx) return 160;
    return Math.max(8, Math.round(Math.sqrt((areaPx * 0.5) / sumK2)));
  }
  return autoFitBaseSize(
    state.logos.map((l) => ({
      maxSide: Math.max(l.w, l.h),
      footprintRadius: l.footprintRadius,
      scale: tierOf(l).pct,
    })),
    state.area,
    padding,
  );
}

// Share of the area's usable space taken up by opaque logo footprint.
function coveragePercent(nodes) {
  const areaPx = state.area.mask.reduce((s, v) => s + v, 0) / (state.area.scale * state.area.scale);
  if (!areaPx) return 0; // fully transparent mask — avoid dividing by zero
  const ink = nodes.reduce((s, n) => {
    const ds = n.displayW / n.logo.w;
    return s + n.logo.opaqueFrac * n.logo.w * n.logo.h * ds * ds;
  }, 0);
  return Math.round((ink / areaPx) * 100);
}

function doShuffle() {
  if (!state.area || !state.logos.length) return;
  state.seed = (state.seed * 7919 + 13) % 100000;
  state.nodes.clear();
  repack();
}

// ---------------- Draw ----------------
function redraw() {
  if (state.area) {
    draw(ctx, state.area, state.placed, {
      showArea: $('showArea').checked,
      whiteBg: $('whiteBg').checked,
    });
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  // in-progress polygon overlay
  if (state.spec.type === 'polygon' && !state.polyClosed) drawPolyDraft();
}

function drawPolyDraft() {
  const pts = state.spec.polygon;
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(123,91,255,0.9)';
  ctx.fillStyle = 'rgba(123,91,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

// ---------------- Drag ----------------
canvas.addEventListener('pointerdown', (ev) => {
  const p = eventToCanvas(canvas, ev);
  // polygon drawing mode: add a vertex
  if (state.spec.type === 'polygon' && !state.polyClosed) {
    state.spec.polygon.push({ x: p.x, y: p.y });
    redraw();
    return;
  }
  const i = hitTest(state.placed, p.x, p.y);
  if (i >= 0) {
    state.drag = { i, dx: state.placed[i].x - p.x, dy: state.placed[i].y - p.y };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(ev.pointerId);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!state.drag) return;
  const p = eventToCanvas(canvas, ev);
  const node = state.placed[state.drag.i];
  node.x = p.x + state.drag.dx;
  node.y = p.y + state.drag.dy;
  state.nodes.set(node.logo.id, { x: node.x, y: node.y });
  redraw();
});

function endDrag(ev) {
  if (!state.drag) return;
  state.drag = null;
  canvas.classList.remove('dragging');
  if (ev.pointerId != null && canvas.hasPointerCapture?.(ev.pointerId))
    canvas.releasePointerCapture(ev.pointerId);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// double-click closes the polygon
canvas.addEventListener('dblclick', () => {
  if (state.spec.type === 'polygon' && !state.polyClosed && state.spec.polygon.length >= 3) {
    closePolygon();
  }
});

function closePolygon() {
  if (state.spec.polygon.length < 3) return;
  state.polyClosed = true;
  rebuildArea();
}

// ---------------- Mask upload ----------------
function loadMask(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    // Cap the working size while preserving aspect ratio.
    const cap = 1600;
    const s = Math.min(1, cap / Math.max(img.width, img.height));
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    state.spec.maskCanvas = c;
    state.spec.width = w;
    state.spec.height = h;
    $('areaW').value = w;
    $('areaH').value = h;
    state.nodes.clear();
    rebuildArea();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// ---------------- Wire controls ----------------
function bindSlider(id, outId, onChange) {
  const el = $(id), out = $(outId);
  el.addEventListener('input', () => { out.textContent = el.value; });
  if (onChange) el.addEventListener('change', onChange);
}

$('areaType').addEventListener('change', (e) => setAreaType(e.target.value));
$('areaW').addEventListener('change', (e) => { state.spec.width = clampDim(e.target.value); e.target.value = state.spec.width; state.nodes.clear(); rebuildArea(); });
$('areaH').addEventListener('change', (e) => { state.spec.height = clampDim(e.target.value); e.target.value = state.spec.height; state.nodes.clear(); rebuildArea(); });
$('polyClose').addEventListener('click', closePolygon);
$('polyClear').addEventListener('click', () => { state.spec.polygon = []; state.polyClosed = false; rebuildArea(); });
$('maskFile').addEventListener('change', (e) => { if (e.target.files[0]) loadMask(e.target.files[0]); });
$('logoFiles').addEventListener('change', (e) => addLogoFiles([...e.target.files]));
$('sizeMode').addEventListener('change', () => {
  $('sizeModeHint').textContent = $('sizeMode').value === 'area'
    ? 'A 100% wide wordmark and a 100% round badge get the same visual weight, so tiers aren’t skewed by logo shape.'
    : 'Tier % sets each logo’s longest side. Compact logos will look heavier than wide ones at the same tier.';
  state.nodes.clear();
  arrange();
});

bindSlider('baseSize', 'baseSizeOut', arrange);
bindSlider('padding', 'paddingOut', arrange);
bindSlider('edgeMargin', 'edgeMarginOut', arrange);
bindSlider('exportScale', 'exportScaleOut');

$('pack').addEventListener('click', arrange);
$('shuffle').addEventListener('click', () => arrange(doShuffle));
$('showArea').addEventListener('change', redraw);
$('whiteBg').addEventListener('change', redraw);
$('download').addEventListener('click', () => {
  if (!state.area) return;
  exportPNG(state.area, state.placed, {
    exportScale: Number($('exportScale').value),
    whiteBg: $('whiteBg').checked,
  });
});

function clampDim(v) { return Math.max(100, Math.min(4000, Number(v) || 800)); }

// The size search runs several packs, so yield a frame to paint the status
// first — otherwise the UI just appears to freeze.
let arranging = false;
function arrange(job) {
  if (arranging || !state.logos.length) return;
  arranging = true;
  setHint('Arranging…');
  // setTimeout, not requestAnimationFrame — rAF never fires in a background
  // tab, which would leave the app stuck on "Arranging…".
  setTimeout(() => {
    try { (typeof job === 'function' ? job : repack)(); }
    catch (err) { console.error(err); setHint('Arrange failed — see console.'); }
    finally { arranging = false; }
  }, 16);
}

// ---------------- Init ----------------
renderTierList();
setAreaType('rect');

// Debug/test handle (harmless in production; used by automated checks).
window.__logoArranger = { state, repack };
