---
description: Execute one routine cycle in this Claude Code session — prep the backlog, then ship one item from docs/BACKLOG.md end to end. Use when the user says "run the routine", "process the backlog", "do the next item", "ship the next task", "run a routine cycle", or wants an unscheduled run. Do NOT use to populate the backlog interactively — that's /prep-backlog.
---

# Run the routine — now

Execute one routine cycle locally in this session, identical to what a scheduled
agent would do.

## What to do

1. **Read `docs/ROUTINE.md` in full.** It is the single source of truth — prep,
   run, tier rules, hard rules, schedule, all of it. If anything here conflicts
   with `docs/ROUTINE.md`, the doc wins.

2. **Follow `docs/ROUTINE.md` end-to-end.** Begin with §2 Prep (autonomously add
   safe items, escalate ambiguous ones in the summary). Then §3 Run (Step 1
   cleanup → Step 2 start one new item). End with the cycle summary from §1.

3. **Ensure `gh` is authenticated** if the cycle will touch PRs/issues. Run
   `gh auth status`; if it fails, surface that and stop rather than guessing.

4. **Use TaskCreate** to track multi-step work within an item — in_progress when
   starting, completed when done.

5. **Report tightly** at the end:

   ```
   Cycle summary
   Prep: <N items added autonomously | nothing new | M candidates escalated — listed below>
   Run: <Item title> — <tier> — <PR # status: merged | awaiting review | CI fix in progress | no item shipped (queue empty)>
   Time: ~<minutes>
   Notes: <anything unexpected — pre-existing CI red, new learning, etc.>

   Suggested for backlog (needs human OK):
   - <title> — <tier> — <why escalated>
   ```

   Omit the "Suggested" section if prep escalated nothing. The report is short by
   design.

## Quiet cycles are correct

If "Next up" is empty, prep finds nothing new, and no in-flight PRs need cleanup,
do nothing and report "nothing to do." Don't invent work. Silence is healthy.

## When to escalate to the user

Only when:

- A `docs/ROUTINE.md` §5 hard rule would be violated (item literally requires
  force-push, destructive data op, etc.).
- The §6 sideways case fires (unexpected repo state, a plan leaves a decision
  unmade, >3 CI fix attempts on one PR).
- An item's tier is genuinely ambiguous after checking §4.

Otherwise run autonomously. The point is removing user-in-the-loop friction.

## Iteration notes

If a cycle surfaces a new failure mode, **don't edit `docs/ROUTINE.md`
mid-cycle** — note it in the report. The user updates the routine deliberately.
