# pvs-js-skill

A skill that runs [PVS-Studio](https://pvs-studio.com/)'s static
analyzer (`pvs-js`) against JavaScript/TypeScript code every time an agent
considers a change finished — not only before a commit.

See [SKILL.md](SKILL.md) for the full workflow the agent follows.

## Prerequisites

`pvs-js` must already be installed, licensed, and on `PATH`. This skill runs
it; it doesn't install or license it.

## Quick usage

```
node scripts/run-pvs-check.js <projectDir> [-- extra pvs-js analyze flags]
```

By default this scopes analysis to files changed according to `git` (staged
+ unstaged + new untracked JS/TS files), and falls back to a full-project
scan if the directory isn't a git repo. Pass `--full` to force a full scan.

## Layout

- [SKILL.md](SKILL.md) — the skill definition: when and how an agent should
  run this check, and how to interpret the results.
- [scripts/run-pvs-check.js](scripts/run-pvs-check.js) — main entry point;
  runs `pvs-js` and prints a readable summary.
- [scripts/collect-changed-files.js](scripts/collect-changed-files.js) —
  lists changed/new JS/TS files via git; called by `run-pvs-check.js`.
- [references/pvs-js-cli.md](references/pvs-js-cli.md) — full `pvs-js` flag
  and exit-code reference, report JSON schema, and platform-specific notes.

## License

Copyright (C) 2026 PVS-Studio LLC

This project is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).