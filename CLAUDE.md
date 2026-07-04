# CLAUDE.md — Logo Arranger

Project instructions for Claude Code. Read this first.

## What this project is

Client-side web app that arranges sponsor logos in a 2D area, sized by sponsor
tier. Transparency-aware: it reads each logo's alpha channel so transparent
corners (e.g. circular PNGs) count as empty space and get spaced evenly, not as
opaque rectangles. Pure static site (HTML/CSS/vanilla JS + Canvas), no backend —
hosted on GitHub Pages.

Full vision / spec: `./docs/SPEC.md`.

Core requirements:
- Alpha-shape packing: use the actual opaque footprint, consistent user-adjustable padding.
- Per-logo % scale (tier size), relative to the smallest logo.
- Area input: preset shapes, custom-drawn polygon, or uploaded mask image/SVG.
- Empty space pushed to the outer border; even padding in the middle.
- Output: live editable canvas (drag to nudge) + PNG download.

## Workflow — the routine (standard across all my projects)

This repo uses the shared **routine workflow**. It is integral, not optional —
treat `docs/ROUTINE.md` as authoritative alongside this file.

- **`docs/ROUTINE.md`** — source of truth for the prep → ship → report cycle, the
  auto-merge vs approval-required tier rules, and the hard safety rules.
- **`docs/BACKLOG.md`** — the work queue. Top of "Next up" ships first.
- **`/prep-backlog`** — interactively queue work (asks before writing).
- **`/run-routine`** — run one cycle now: prep, then ship the top item end to end.
- **`/human-task-list`** — compact list of what only *you* need to do.

When asked to "do the next thing" / "ship a task" / "process the backlog," run
`/run-routine`. When asked "what do I need to do," run `/human-task-list`.

## Conventions

- Default branch: `main`. Feature branches: `routine/<slug>` or `<type>/<slug>`.
- No build step — files are served as-is by GitHub Pages. `index.html` at repo root.
- Verify before pushing: open `index.html` locally (or run a static server) and
  confirm the arranger loads and packs a sample set with no console errors.
- Use ES modules under `js/`; keep the algorithm (`js/packer.js`) separate from UI.

## Safety (also enforced in `.claude/settings.local.json`)

Never force-push, `reset --hard`, weaken CI, commit secrets/`.env*`, or run
irreversible data operations. Prefer reversible actions; verify state before
anything destructive. See `docs/ROUTINE.md` §5 for the full list.
