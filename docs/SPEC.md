# Logo Arranger — Spec

## Goal

Speed up arranging sponsor logos in a visually appealing layout inside any 2D
area, sized by sponsor tier, with transparency treated as empty space.

## Requirements (from project owner)

1. **Transparency-aware** — not a generic square arranger. Reads each logo's alpha
   channel. Transparent regions (e.g. corners of a circular logo PNG) count as
   empty space and are spaced as evenly as possible, not padded as if opaque.
2. **Consistent, user-adjustable padding** between logos (in area units / px).
3. **Per-logo % scale** setting the tier size, relative to the smallest logo
   (100%). Example: platinum 300%, bronze 100%.
4. **Any 2D cutout** as the fill area.
5. **Empty space to the outer border**, even padding maintained in the middle.

## Decisions (interview)

- **Area input:** all three — preset shapes (rect/circle/ellipse), custom-drawn
  polygon, and uploaded mask image/SVG (opaque = fillable, transparent = outside).
- **Logo + tier:** upload PNGs, per-logo % scale field.
- **Output:** live editable canvas (drag to nudge placed logos) + PNG download.
- **Packing:** alpha-shape packing — compute each logo's opaque footprint from the
  alpha channel and pack using that, with even padding.

## Approach (v1)

- **Area → mask bitmap.** Every area type is rasterized to a binary mask
  (inside/outside) at working resolution. Preset shapes and polygons drawn
  directly; uploaded images use alpha (or luminance for opaque images) as the mask.
- **Logo → footprint.** Each uploaded logo is drawn to an offscreen canvas; the
  alpha channel gives a tight opaque bbox and an approximate footprint radius
  (used for spacing so transparent corners don't reserve space).
- **Scale.** Logo render size = base size × (scale% / 100). Base size derived from
  the area size and logo count so the set fits.
- **Pack.** Seed positions inside the mask, then relaxation:
  repel overlapping footprints (respecting padding), pull loosely toward the area
  centroid, and constrain every footprint to stay inside the mask. Result: even
  interior padding, empty space pushed to the border.
- **Edit + export.** Placed logos are draggable on the canvas; export flattens to
  a PNG at chosen resolution.

## Non-goals (v1)

- No backend, accounts, or persistence beyond local session.
- No true optimal bin-packing / no per-pixel collision — footprint approximation.

## Stack

Static site: `index.html` + `css/` + ES modules under `js/`. Canvas 2D API.
No build step. Hosted on GitHub Pages.
