#!/usr/bin/env node
/**
 * collect-changed-files.js — list changed/new JS/TS files via git, suitable
 * as input to `pvs-js analyze --source-files`.
 *
 * Cross-platform on purpose: git's CLI behaves the same on Windows, Linux,
 * and macOS, and Node's child_process/fs give us a consistent way to call it
 * without caring whether the shell is bash, cmd, or PowerShell.
 *
 * Usage:
 *   node collect-changed-files.js [projectDir]
 *
 * Behavior:
 *   - Includes: staged changes, unstaged changes, and untracked new files
 *     (all filtered to JS/TS extensions), relative to the current git state.
 *   - Excludes: deleted files (nothing to analyze) and anything gitignored.
 *   - Prints one absolute path per line to stdout.
 *   - If the directory isn't a git repo, prints nothing and exits with code 2
 *     — the caller should then decide whether to fall back to a full scan.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const JS_TS_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);

// Signals to the caller (run-pvs-check.js) that it should fall back to a
// full scan instead of retrying.
const NOT_A_GIT_REPO_EXIT_CODE = 2;

function run(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const projectDir = path.resolve(process.argv[2] || ".");

  const isRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  if (isRepo.error || isRepo.status !== 0) {
    // Not a git repo (or git isn't installed) — nothing we can diff against.
    process.exit(NOT_A_GIT_REPO_EXIT_CODE);
  }

  const staged =
    run(
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      projectDir,
    ) || [];
  const unstaged =
    run(["diff", "--name-only", "--diff-filter=ACMR"], projectDir) || [];
  const untracked =
    run(["ls-files", "--others", "--exclude-standard"], projectDir) || [];

  const combined = new Set([...staged, ...unstaged, ...untracked]);

  const files = [...combined]
    .filter((relPath) => JS_TS_EXTENSIONS.has(path.extname(relPath)))
    .map((relPath) => path.resolve(projectDir, relPath))
    .filter((absPath) => fs.existsSync(absPath)); // drop deletions

  for (const file of files) {
    process.stdout.write(file + "\n");
  }
}

main();
