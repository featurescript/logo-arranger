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
- **User-adjustable padding** kept consistent across the interior.
- **Any 2D area** — rectangle, circle, ellipse, a custom-drawn polygon, or an
  uploaded mask image/SVG (opaque = fillable, transparent = outside).
- **Empty space to the border** — a border-clearance control clusters logos in
  the middle and pushes slack to the outer edge.
- **Editable** — drag any placed logo to nudge it; re-run *Arrange* to reflow.
- **PNG export** at 1–4× scale, transparent or white background.

## How it works

1. Every area type is rasterized to a binary mask, then a **distance transform**
   gives the distance from any interior point to the nearest border.
2. Each logo is trimmed to its opaque bounding box; its footprint radius is the
   radius of a circle with the same opaque-pixel area.
3. A **relaxation packer** runs repulsion (even spacing + padding), distance-field
   containment (stay inside the shape), and a centripetal pull (empty space to the
   border) until the layout settles.

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
