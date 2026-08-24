---
name: pvs-js-skill
description: Runs PVS-Studio's static analyzer (pvs-js) against JavaScript/TypeScript code the agent has written or modified, before considering the work finished, committing, or handing it back to the user. Use this skill whenever you are about to wrap up a coding task that touched .js/.ts/ files, before running `git commit`, before saying a change is "done" or "ready", and any time you've just written or edited JS/TS code — even if the user didn't explicitly ask for static analysis. Also use it mid-task if you want a sanity check after a risky edit. Do not skip this just because the change looks small. Requires PVS-Studio (pvs-js) to already be installed and licensed on the machine — this skill runs it, it does not install or license it.
---

# Static Analysis Checkpoint (PVS-Studio)

## Why this matters

Code that "looks right" often isn't — a subtle type coercion, a copy-pasted condition that always evaluates the same way, a missing null check on a path that's rarely hit. PVS-Studio catches a class of bugs that's genuinely hard to spot by reading code, because its diagnostics are built from patterns seen across huge amounts of real-world bugs. Running it routinely, right after you finish a change, means problems surface while you still have full context on what you just wrote — not later, out of context, after the user has already trusted the change.

The goal isn't to run a tool for its own sake. It's to make sure that when you say a change is done, it actually is.

## When to run this

Run the checks:
- **Before you consider a coding task complete** — right before you'd normally tell the user "done" or move to the next task.
- **Before any commit** you make on the user's behalf.
- **After a risky or wide-reaching edit** (touching shared logic, refactoring, editing config), even mid-task, since catching a break early saves rework later.

You don't need to re-run after every single keystroke — that's noisy and slow. Batch it: finish the logical unit of work, then check.

## Workflow

1. **Run the checkpoint script:**
   ```
   node <skill-path>/scripts/run-pvs-check.js <projectDir>
   ```
   By default this scopes analysis to files changed according to `git`
   (staged + unstaged + new untracked JS/TS files) — this matches "check what
   I just did," not "check the whole codebase from scratch every time," and
   keeps runs fast. If the directory isn't a git repo, it automatically falls
   back to a full-project scan. Pass `--full` yourself to force a full scan
   regardless (e.g. if you suspect your change affected type inference
   somewhere else in the project).

2. **Read the result.** The script prints either "Clean" or a per-file list
   of warnings (`line:column [code] (level N) message`), and exits `1` if
   anything was found. See `references/pvs-js-cli.md` for the full exit-code
   table — most of the time you'll only see `0` (clean) or `1` (warnings),
   but a few codes need special handling (below).

3. **If warnings are found, fix them and re-check.** Unlike a linter, PVS-Studio
   has **no autofix** — every warning needs you to actually read it, understand
   what pattern it's flagging, and edit the code. After fixing:
   - Re-run the checkpoint script.
   - Repeat for up to **3 rounds** of fix-and-recheck.
   - If problems remain after 3 rounds, stop. Don't keep guessing — summarize
     for the user what's still failing (the exact warnings, which files, what
     you tried), and ask how they'd like to proceed. A warning that survives
     3 honest attempts usually means either a genuine design question or a
     false positive, and both need a human call.

4. **If clean, say so briefly and move on.** A one-line confirmation ("PVS-Studio
   check: clean") is enough — no need to narrate the whole process unless
   something interesting happened.

## Interpreting warnings

- **Level matters less than you'd think.** PVS-Studio's confidence levels
  (1-3) filter noise, but a level-2 or level-3 warning on code you just wrote
  is still worth a real look — don't dismiss it purely because it's not
  level 1.
- **Don't suppress to make the run pass.** `pvs-js suppress` exists to
  baseline *pre-existing* warnings in code you didn't touch (see
  `references/pvs-js-cli.md`), not as a shortcut for warnings in new code.
  If a warning is genuinely a false positive on code you just wrote, say so
  explicitly to the user rather than silently suppressing it.
- **Pre-existing warnings in files you touched but didn't cause:** if a
  warning is on a line you didn't change, mention it to the user as a
  separate note rather than fixing it as a drive-by — that muddies the diff
  and risks unrelated breakage, unless they've asked you to clean up the
  file broadly.

## Special exit codes — don't just retry

Most runs end in `0` or `1`. A few other codes mean something categorically
different and should short-circuit the normal fix-and-recheck loop:

- **20 / 21 / 22 (license expired / expiring / missing)** — stop immediately
  and tell the user. This is a one-time human setup problem (renewing or
  activating a license), not something to work around, retry, or silently
  route around with a flag.
- **2 / 3 (bad config / internal error)** — stop and report the exact error
  to the user rather than guessing at a fix; these usually mean something is
  wrong with the analyzer setup itself, not with the code being checked.
- **4 (everything excluded)** — usually means your `--source-files` list
  didn't match anything the config considers analyzable. Worth a second
  look at `pvs-settings.toml` / `--analysis-paths` if this is unexpected,
  but on its own isn't a code problem.
- **5 / 6 (partial parse failure / timeout)** — the script will still report
  any warnings it did find, but flags that coverage was incomplete for some
  files. Mention this to the user if it affects a file central to the change.

## Prerequisites (not this skill's job to set up)

This skill assumes `pvs-js` is already installed, licensed, and on `PATH`.
It deliberately doesn't try to install, license, or configure PVS-Studio —
that's a one-time human setup step, platform-specific, and not something to
improvise around. If `run-pvs-check.js` reports it can't find `pvs-js` at
all, tell the user rather than trying alternate install paths yourself.

## Bundled resources

- `scripts/collect-changed-files.js` — lists changed/new JS/TS files via
  git. Called automatically by `run-pvs-check.js`; run it standalone if you
  just want the file list for something else.
- `scripts/run-pvs-check.js` — the main entry point (step 1 above). Pure
  Node, no dependencies, works the same on Windows/Linux/macOS. Extra
  `pvs-js analyze` flags can be passed through after a literal `--`, e.g.
  `node run-pvs-check.js . -- --rules OWASP=on`.
- `references/pvs-js-cli.md` — full flag and exit-code reference, report
  JSON schema, and platform-specific notes (license file locations, report
  conversion for humans). Read this when you need something beyond the
  workflow above — custom rule sets, monorepo path exclusions, suppression.
