---
description: Compress all pending human-review tasks into a minimal step-by-step action list. Shows only what the user must personally do, in priority order, with the smallest possible context per item. Use when the user wakes up, sits back down after time away, or asks "what do I need to do".
---

# Your action list

Scan the repo and produce a compact step-by-step list of things only the user can
do. Filter aggressively — the routine handles most work autonomously.

## What counts as a "human task"

- Open **approval-required** PRs awaiting review (`gh pr list` filtered by tier
  per `docs/ROUTINE.md` §4).
- Items requiring work the routine can't do: external dashboards, account/billing
  settings, repo settings, secret/token provisioning, env-var values.
- One-off setup the routine flagged (token rotation, app install, etc.).
- "Stop and ask" decision points logged by previous routine runs (check recent PR
  comments and routine reports in `git log`).
- Plans/briefs the user still owes — without them the routine has no spec'd work
  to ship.

## What does NOT count — don't list these

- Auto-merge-tier items in "Next up" (routine handles them automatically).
- "In progress" items the routine is still working.
- Closed/merged PRs.
- Soft suggestions ("you should review the architecture") — only **specific,
  completable actions**.

## Output format — strict

Sort by: (1) blockers first, (2) quick wins (≤ 2 min) second, (3) bigger reviews
last. For each item, exactly this shape:

```
N. <Imperative verb> <thing> — <one-line context>
   📍 <URL or file path>
   ⏱  <time estimate, e.g. 30s / 2min / 10min>
   🚧 <what this unblocks, if anything>
```

Keep each item ≤ 4 lines. Skip the 🚧 line if it doesn't block anything.

If there's nothing to report:
```
✅ Nothing on your plate. Routine is unblocked.
```

Don't add headings, summaries, or commentary above or below the list. The list IS
the output. The user is busy and skimming.

## Tone

Direct. Imperative. No hedging. Don't explain *why* something is a blocker unless
it fits in the one-line context.

## How to gather data

In parallel:
1. `gh pr list --state open --json number,title,headRefName,statusCheckRollup`
2. Read `docs/BACKLOG.md` (focus on "In progress")
3. `git log --oneline --since="3 days ago"` — scan for "stop and ask" patterns
4. Cross-reference each open PR with the §4 tier rules to confirm which need
   approval vs auto-merge
5. For each approval-required PR, fetch its description for the plain-English
   summary and any preview URL

## Don't fabricate, don't execute

If you see no real blocker after scanning, output `✅ Nothing on your plate`.
Don't manufacture work. This skill is **read-only** — no commits, no PR comments,
no merges. Just the summary; the user acts, then `/run-routine` resumes.
