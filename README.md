# Logo Arranger

Arrange sponsor logos in any 2D area, sized by sponsor tier, with **even,
transparency-aware spacing**. Transparent regions of a logo (e.g. the corners of
a circular PNG) count as empty space — so logos are spaced by their actual visible
mass, not by a bounding box.

**Live:** https://featurescript.github.io/logo-arranger/

## Features

- **Alpha-footprint packing** — each logo's opaque area (read from its alpha
  channel) drives spacing, so circular/irregular logos space evenly.
- **Per-logo % scale** for tiers — e.g. platinum 300%, bronze 100%.
- **Fills the area** — Arrange grows the logos to the largest size that still
  packs cleanly, rather than settling for the first size that happens to fit.
- **User-adjustable padding** kept consistent across the interior, plus a
  separate edge margin for the outer border.
- **Any 2D area** — rectangle, circle, ellipse, a custom-drawn polygon, or an
  uploaded mask image/SVG (opaque = fillable, transparent = outside).
- **Empty space to the border** — a border-clearance control clusters logos in
  the middle and pushes slack to the outer edge.
- **Editable** — drag any placed logo to nudge it; re-run *Arrange* to reflow.
- **PNG export** at 1–4× scale, transparent or white background.

## How it works

1. Every area type is rasterized to a binary mask, then a **distance transform**
   gives the distance from any interior point to the nearest border.
2. Each logo is trimmed to its opaque bounding box, then its opaque region is
   decomposed into a **set of collision circles** (greedy cover over a distance
   transform of the alpha mask) — a wide wordmark collides along its full
   length, while a round logo's transparent corners stay usable.
3. A **relaxation packer** runs circle-set repulsion (even spacing + padding)
   and distance-field containment (stay inside the shape), seeded either from
   rows (best for wordmarks) or a spiral, then a deterministic resolve pass
   removes any residual overlap.
4. **Arrange searches for the largest size that fits** — it grows the logos
   while they still pack, then bisects to find the maximum, trying several
   starting layouts at each size. The "Max logo size" slider is only an upper
   bound; the app fills the area up to it.

See [`docs/SPEC.md`](docs/SPEC.md) for the full design.

## Run locally

No build step. Serve the folder statically (ES modules need HTTP, not `file://`):

```
npx serve .
# or: python -m http.server
```

Then open the printed URL.

## Stack

Vanilla JS (ES modules) + Canvas 2D. No dependencies, no backend.
