# Routine — automation prompt

**This file is the source of truth for the routine.** The slash commands
`/run-routine`, `/prep-backlog`, and `/human-task-list` all read this doc each
time they run, so editing it here changes their behavior with no re-pasting. If
this project also has a *scheduled* agent (see §7), that agent reads this file
too.

Each cycle is self-contained: it preps the backlog, then ships one item.
Running multiple cycles is fine.

> **Adapt this doc to the project.** The structure below is generic. Fill in the
> real verify command (§3 step 6), the real auto-merge vs approval-required paths
> (§4), and any project-specific hard rules (§5). The closer §4 maps to *this*
> repo's actual sensitive surfaces, the more the routine can do safely on its own.

## 1. What the routine does

Each cycle, in order:

1. **Prep** — scan the repo for new candidate items, classify them against the
   tier rules (§4), add safe items to `docs/BACKLOG.md` autonomously, and surface
   ambiguous ones in the cycle summary for human triage. See §2.
2. **Run** — clean up in-flight PRs from previous cycles, then start at most one
   new item from the top of "Next up." See §3.
3. **Report** — emit a short cycle summary: what was prepped, what shipped, and
   anything that needs a human.

If both prep and run find nothing, the cycle is a no-op — report "nothing to do"
and stop. Silence is correct.

## 2. Prep behavior

Read `docs/BACKLOG.md` first to know what's already queued. Then scan for new
candidates from these sources:

- **`TODO` / `FIXME` / `HACK` markers** in the source tree.
- **Open issues** (`gh issue list --state open`) not already linked from BACKLOG.
- **Recently merged PRs** (`git log --merges --since="3 days ago"`) for follow-ups
  noted in commit messages or PR descriptions ("see also," "fix later," "TODO in
  a follow-up").
- **Stale PR comments** on open PRs (questions or asks left unresolved).
- **Pre-existing CI red on `main`** — if main is red, queue a "fix CI red" item at
  the top.

For each candidate, classify against §4.

### Auto-add rules — add to BACKLOG without asking

Add a candidate to "Next up" autonomously **only when all of these hold**:

- The change touches **only auto-merge-tier paths** (§4).
- The acceptance criteria are **unambiguous** — a one-line description tells the
  next cycle exactly what to do.
- Effort is **small** (≤ ~30 min). Larger items need a written plan/brief first;
  flag them in the cycle summary instead of queuing them blind.

When autonomously adding, commit the BACKLOG update directly to `main` (see §3).
One commit per cycle aggregating all auto-added items, message like
`BACKLOG: add N items (prep cycle)`.

### Escalate rules — surface, do NOT write to BACKLOG

For everything else, list the candidate under **"Suggested for backlog (needs
human OK)"** in the cycle summary, with: title (one line), tier (§4), and why it
can't auto-add (ambiguous spec / unclear reversibility / needs a plan). Don't
write these to BACKLOG. The user adds them via `/prep-backlog` if they agree.

> Touching an approval-required path is **not** by itself a reason to escalate.
> Such items may be **queued** and tagged approval-required; they stop for human
> merge approval at run time (§3/§4), not at queue time. Escalate only when the
> spec is ambiguous or a decision is unmade.

### Idempotence

Prep is idempotent. Re-running with no new findings is a no-op: no commit, no
BACKLOG change. Empty summaries are correct.

## 3. Run behavior

Ship **one new item per cycle, max.** Cleanup of in-flight PRs doesn't count
against that limit.

### Step 1 — Clean up in-flight PRs first

Read `docs/BACKLOG.md`. For every item under "In progress," check the linked PR:

- **Already merged** → move the BACKLOG item to "Done." Commit directly to `main`.
- **CI green + auto-merge tier** → squash-merge, delete the branch, move the item
  to "Done." Commit directly to `main`.
- **CI green + approval-required tier** → leave it open. **Continue to Step 2
  anyway** — approval-required PRs do NOT block new work. The user reviews on
  their own schedule.
- **CI red** → read the failing log, push a fix. After 3 fix attempts on one PR,
  leave a comment summarizing what's failing and continue to Step 2.
- **No CI yet** → leave it. Continue to Step 2.

### Step 2 — Start one new item (if Next up has anything)

1. Take the top item from "Next up." (The user controls priority by ordering.)
2. If the item links to a plan/brief, read it — that's the spec. Otherwise the
   one-line description is the spec (small fixes only).
3. **Commit the BACKLOG move directly to `main` first** — move the item to
   "In progress" with the upcoming branch name, then push. See "BACKLOG state
   tracking" below.
4. Create the feature branch: `routine/<short-slug>` off the updated `main`.
5. Implement the change. Track multi-step work with TaskCreate.
6. **Run the project's verify step locally before pushing** — whatever "green"
   means for this repo (tests / lint / typecheck / build). Check `package.json`
   scripts, a `Makefile`, or the README; if the project genuinely has no verify
   step yet, say so in the summary rather than skipping silently. Fix anything red.
7. Push, open a PR. The description references the plan (if any), gives a
   plain-English summary, and states the tier and why.
8. Wait for CI. Apply the same handling as Step 1.
9. After auto-merge (auto-merge tier): move the item to "Done" directly on `main`.

If "Next up" is empty, do nothing. Stop.

### BACKLOG state tracking — commit directly to main

All BACKLOG.md state changes ("Next up" ↔ "In progress" ↔ "Done") commit
**directly to `main`**, not in feature branches. This decouples backlog tracking
from PR review timing and avoids list-renumber conflicts when several items are
in flight. The feature branch contains only the change for the item being shipped.

**Fallback when direct-to-main is blocked.** If protected-branch rules reject a
direct push to `main` (e.g. a scheduled agent without bypass gets a `403`), fold
the BACKLOG state change into that item's single feature PR so it lands atomically
on merge. With one item in flight per cycle there's no renumber conflict, so the
outcome is identical. Don't treat the `403` as an error to escalate.

## 4. Tier rules — EDIT THESE PER PROJECT

The whole routine's safety rests on this section. Map it to *this* repo.

This is a single-page static site with **no backend, no auth, no datastore, no
CI**. Classify by the *nature* of the change, not by path.

### Auto-merge tier (default)

Ship when the change is a self-contained, reversible front-end change and the app
still loads + packs a sample set with no console errors:

- Documentation: `docs/`, root-level `*.md` (`README.md`, `CLAUDE.md`, etc.)
- UI/CSS tweaks, copy changes, `index.html` markup.
- Packing-algorithm changes in `js/packer.js` (and helpers) that keep the app working.
- New self-contained features (export options, area shapes, controls).

### Approval-required tier — STOP and ask

Do **not** auto-merge; post a plain-English summary + the Pages URL and leave open when:

- Editing GitHub Pages / deploy config or `.github/workflows/**`.
- Adding a build step, bundler, or backend (changes how the site is served/hosted).
- Adding third-party runtime dependencies loaded from a CDN or npm (supply-chain surface).
- Any deletion of more than ~50 lines from a single existing file.
- **Anything you're not certain is reversible.**

When you stop for approval, the PR comment states: what it changes (plain
English), what surface it touches, whether it's reversible (be honest — `git
revert` works for most code; migrations and data deletions often don't), and a
preview URL if available.

## 5. Hard rules — never do these, ever

- Never `git push --force` to any branch, especially `main`.
- Never amend or rebase commits already on `main`.
- Never merge a PR with red or pending CI.
- Never bypass branch protection.
- Never run destructive/irreversible data operations (dropping tables, deleting
  data without a narrow filter) against any real datastore.
- Never commit secrets, API keys, or `.env*` files holding real values.
- Never edit or delete migration files once written — migrations are append-only.
- Never weaken, skip, or disable CI checks to make something pass.
- Never `git reset --hard` or otherwise discard committed work.
- Never delete branches with unmerged commits.

If a backlog item *requires* one of these, stop and ask the user how to proceed.

## 6. When something goes sideways

If you hit an error you don't understand, or the repo is in an unexpected state
(uncommitted changes on `main`, missing files, unexpected branches), stop and
report what you saw. Don't auto-clean — the user's in-progress work might be there.
If a plan leaves a decision unmade, stop and ask the specific question. Don't guess.

## 7. Schedule (optional)

A routine can run purely on demand via `/run-routine`, or on a schedule via a
remote agent. If you want it scheduled, a sane default is 2–3 cycles/day spaced
≥ 5 hours apart (keeps each cycle in its own API rate-limit window) at off-round
times (e.g. `:15`, `:30`) to dodge cron-rush. Use the `/schedule` skill (or the
`mcp__scheduled-tasks__*` tools) to set it up; the scheduled agent reads this doc
each cycle, so changing cadence only changes the cron strings, not the prompt.

## 8. Iteration

If a cycle surfaces a new failure mode, **don't edit this doc mid-cycle** — note
it in the report. The user updates the routine deliberately. Consistency beats
opportunistic mid-cycle changes.
