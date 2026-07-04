// main.js — wires the UI to the area builder, packer, and renderer.
import { loadLogo } from './logo.js';
import { buildArea } from './area.js';
import { pack, autoFitBaseSize } from './packer.js';
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
};

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

    const scaleWrap = document.createElement('span');
    scaleWrap.className = 'logo-scale-wrap';
    const scaleIn = document.createElement('input');
    scaleIn.type = 'number';
    scaleIn.min = '10'; scaleIn.max = '1000'; scaleIn.step = '10';
    scaleIn.value = logo.scale;
    scaleIn.addEventListener('change', () => {
      logo.scale = Math.max(10, Math.min(1000, Number(scaleIn.value) || 100));
      scaleIn.value = logo.scale;
      repack();
    });
    scaleWrap.append(scaleIn, document.createTextNode('%'));

    const del = document.createElement('button');
    del.className = 'logo-del';
    del.innerHTML = '&times;';
    del.title = 'Remove';
    del.addEventListener('click', () => {
      state.logos = state.logos.filter((l) => l !== logo);
      state.nodes.delete(logo.id);
      renderLogoList();
      repack();
    });

    li.append(thumb, name, scaleWrap, del);
    list.appendChild(li);
  });
}

function fitThumb(c, src, box) {
  const s = Math.min(box / src.width, box / src.height);
  const w = src.width * s, h = src.height * s;
  c.drawImage(src, (box - w) / 2, (box - h) / 2, w, h);
}

// ---------------- Layout / pack ----------------
function computeNodes() {
  const baseSize = Number($('baseSize').value);
  return state.logos.map((logo) => {
    const maxSide = Math.max(logo.w, logo.h);
    const ds = (baseSize / maxSide) * (logo.scale / 100);
    const prev = state.nodes.get(logo.id);
    return {
      logo,
      r: logo.footprintRadius * ds,
      displayW: logo.w * ds,
      displayH: logo.h * ds,
      x: prev?.x,
      y: prev?.y,
    };
  });
}

function repack() {
  if (!state.area || !state.logos.length) { state.placed = []; redraw(); return; }
  const nodes = computeNodes();
  pack(nodes, state.area, {
    padding: Number($('padding').value),
    borderClearance: Number($('centerPull').value) / 100,
    iterations: 480,
  });
  nodes.forEach((n) => state.nodes.set(n.logo.id, { x: n.x, y: n.y }));
  state.placed = nodes;
  redraw();
}

function doAutoFit() {
  if (!state.area || !state.logos.length) return;
  const items = state.logos.map((l) => ({
    maxSide: Math.max(l.w, l.h),
    footprintRadius: l.footprintRadius,
    scale: l.scale,
  }));
  const B = autoFitBaseSize(items, state.area, Number($('padding').value));
  $('baseSize').value = B;
  $('baseSizeOut').textContent = B;
  state.nodes.clear(); // fresh seed for a clean fit
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

bindSlider('baseSize', 'baseSizeOut', repack);
bindSlider('padding', 'paddingOut', repack);
bindSlider('centerPull', 'centerPullOut', repack);
bindSlider('exportScale', 'exportScaleOut');

$('pack').addEventListener('click', repack);
$('autofit').addEventListener('click', doAutoFit);
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

// ---------------- Init ----------------
setAreaType('rect');
