---
description: Populate docs/BACKLOG.md with new items interactively (with human confirmation), without running the routine. Use when the user says "prep the backlog", "queue up work", "set up for the routine", "what should we add to the backlog", "fill the backlog", or otherwise wants to add items but NOT trigger a routine cycle. Do NOT use for executing items — that's /run-routine.
---

# Prep BACKLOG interactively

Populate `docs/BACKLOG.md` with items the next routine cycle will process. The
user is queuing work, not executing it. This is the **interactive counterpart**
to the prep behavior in `docs/ROUTINE.md` §2 — same scan, same tier
classification, but with human confirmation instead of the autonomous
add-or-escalate split.

## What to do

1. **Read `docs/ROUTINE.md` §2 (Prep) and §4 (Tier rules).** Source of truth for
   what to scan and how to classify. Re-read every invocation — the doc evolves.

2. **Read current state** (in parallel):
   - `docs/BACKLOG.md` — what's in Next up / In progress / Done
   - `gh pr list --state open` — in-flight PRs
   - `git log --oneline -10` — recent commits

3. **Scan the sources listed in `docs/ROUTINE.md` §2** for real drift. Don't
   invent work.

4. **Propose 2–5 items.** For each: **Title** (one line, action-oriented),
   **Tier** (auto-merge or approval-required, per §4), **Rationale** (1–2
   sentences), **Effort** (S ≤ 10 min, M 10–30 min, L > 30 min). L items need a
   written plan first — flag them, don't queue them blind.

5. **Get user confirmation before writing.** Ask whether they want all items, a
   subset, or different priorities. Unlike the routine's autonomous mode,
   *nothing* lands in BACKLOG without the user's OK here.

6. **Write to BACKLOG.md** in priority order — auto-merge items at the top so the
   next cycle ships them first; approval-required below.

7. **Commit directly to `main`** (per `docs/ROUTINE.md` BACKLOG state rule) with a
   message like `BACKLOG: add N items (M auto-merge, K approval-required)`. Push.

8. **Report tightly:** items queued + tiers; whether to run `/run-routine` now or
   wait; any blockers noticed (open approval-required PRs, red CI on main).

## Hard nos

- Don't queue large items (need a plan/brief) as one-line BACKLOG entries.
- Don't queue items that require human-only work (external dashboards, billing,
  account settings) — the routine can't do those. List them for the user instead.
- Don't auto-execute. This stops at "queue populated"; `/run-routine` runs it.
- Don't push BACKLOG state in feature branches — always direct-to-`main`.

## When you find a blocker

If `main` has red CI, the next cycle will burn its run fixing that instead of new
work. Suggest the user either add a "fix CI red" item at the top of the queue, or
fix it manually before the next cycle. Don't let it sit.
