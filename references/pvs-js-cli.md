# pvs-js CLI reference

Condensed from the official docs: https://pvs-studio.ru/ru/docs/manual/7195/
(and https://pvs-studio.ru/ru/docs/manual/0038/ for report conversion). Consult
this file when `scripts/run-pvs-check.js` doesn't cover what you need —
custom rule sets, suppression, monorepo layouts, or license file locations.

## Two modes

- `pvs-js analyze <projectDir> [flags]` — runs the analysis.
- `pvs-js suppress <report.json> [--output file]` — marks the warnings in a
  report as suppressed, so future `analyze` runs won't report them again.
  Useful for baselining pre-existing warnings in a legacy file you didn't
  touch, so they stop showing up as noise — **don't use this to silence a
  warning in code you just wrote**; fix it instead.

## Flags used by `run-pvs-check.js` (and why)

| Flag | Why |
|---|---|
| `--output <path>` | Write the JSON report somewhere we control, so we can parse it. |
| `--indicate-warnings` | Without this, `analyze` exits `0` even when warnings were found. We rely on exit code `1` to detect "warnings present." |
| `--no-noise` | Drops low-confidence warnings. Keeps the signal-to-noise ratio high for an agent that's going to act on every line of output. |
| `--source-files <file>` | Scopes analysis to a list of paths (one per line) — this is how we check only the changed files instead of the whole project. |

## Other flags worth knowing about

- `--rules <spec>` — turn diagnostic groups/ranges on or off, e.g.
  `--rules ALL=off --rules V7001-V7031=on` or `--rules OWASP=on`. The
  analyzer defaults to only the general-analysis group (`GA=on`). If a
  project has its own `pvs-settings.toml` (the default config file the
  analyzer looks for in the analyzed directory), prefer letting the project
  own this decision rather than overriding it from the skill.
- `--analysis-paths <spec>` — include/exclude paths or globs, e.g. to skip
  `3rd-party/` or `unittests/`. Independent from `--source-files`: this
  controls *policy* (what's ever eligible), `--source-files` controls *scope
  for this run* (what to check this time).
- `--suppress-files <path>` — read one or more suppression files. Defaults to
  `suppress_file.suppress.json` in the analyzed directory if present.
- `--threads <n>` / `--file-analysis-timeout <XXhYYmZZs>` — performance
  tuning; defaults are usually fine, raise the timeout for very large files
  that legitimately need more than 10 minutes.
- `--source-tree-root <path>` — replaces the project root in report paths
  with a portable `|?|` marker. Not used by `run-pvs-check.js` since we parse
  the report locally and want real paths; relevant if reports get shared
  across machines.
- `--ignore-analysis-failures` — suppresses the non-zero exit code for
  non-critical issues (partial parse, timeout, incomplete semantic info).
  Not used by default in `run-pvs-check.js`, since silently swallowing these
  hides real coverage gaps — but there ARE cases you might want it (e.g. a
  known-flaky third-party file). Add it explicitly via the `--` passthrough
  if you decide that's the right call, don't just add it reflexively.
- `--security-related-issues` — adds ГОСТ Р 71207-2024 SEC-labels to
  warnings. Not relevant unless the project specifically tracks that
  standard.

## Exit codes — `analyze`

| Code | Meaning | What to do |
|---|---|---|
| 0 | Clean | Proceed |
| 1 | Warnings found (only with `--indicate-warnings`) | Read the report, fix, re-check |
| 2 | Invalid analyzer configuration (CLI flags or config file) | Fix the config, don't retry blindly |
| 3 | Unexpected internal error | Don't retry; if reproducible, worth reporting upstream |
| 4 | All files excluded from analysis | Check `--analysis-paths` / config — likely means nothing was actually checked |
| 5 | Some files failed to analyze (parse error) | Coverage is incomplete for those files; note it |
| 6 | Some files timed out | Coverage is incomplete for those files; consider `--file-analysis-timeout` |
| 20 | License expired | Stop — needs a human to renew |
| 21 | License expires within a month | Analysis still ran; flag it so it gets renewed |
| 22 | License missing or invalid | Stop — needs a human to set up |

## Exit codes — `suppress`

| Code | Meaning |
|---|---|
| 0 | All warnings suppressed successfully |
| 1 | Some warnings not suppressed (non-critical error) |
| 2 | Invalid input |
| 3 | Unexpected internal error |

## License file locations (platform-specific)

- Windows: `Settings.xml`
- Linux/macOS: `PVS-Studio.lic`

Override with `--license-file <path>` if it's not in the default location
the analyzer expects.

## Report conversion (optional — for humans, not for the agent)

`run-pvs-check.js` parses `PVS-Studio.json` directly, so conversion isn't
needed for the agent's own workflow. It's useful if you want to hand a
report to a person in a more digestible format (e.g. to paste into a PR
description or email):

- Linux/macOS: `plog-converter -t errorfile PVS-Studio.json` (prints
  GCC/Clang-style `file:line: message` to stdout)
- Windows: `PlogConverter.exe -t Html -o . PVS-Studio.json` (writes an HTML
  report — `errorfile`-equivalent isn't in the Windows tool's format list, so
  HTML or CSV are the more readable options there)

Both ship as part of the PVS-Studio C/C++ distribution, which is a
prerequisite for the JS/TS analyzer anyway.

## `PVS-Studio.json` report schema (as used by `run-pvs-check.js`)

```jsonc
{
  "warnings": [
    {
      "code": "V1234",         // diagnostic rule id
      "message": "...",        // human-readable description
      "level": 1,               // confidence level, 1-3
      "positions": [            // usually one entry; some diagnostics
        {                       // reference more than one code location
          "file": "/abs/path/to/file.ts",
          "line": 42,
          "column": 7
        }
      ]
      // additional fields (CWE id, SAST id, dedup hash) exist but aren't
      // used by run-pvs-check.js — check a real report if you need them.
    }
  ]
}
```
