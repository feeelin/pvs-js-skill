#!/usr/bin/env node
/**
 * run-pvs-check.js — run PVS-Studio's JS/TS analyzer (`pvs-js`) scoped to
 * changed files, and print a readable summary the agent can act on directly.
 *
 * Cross-platform: pure Node (child_process/fs/os), no shell scripting, so it
 * behaves the same on Windows/Linux/macOS as long as `pvs-js` and `git` are
 * on PATH.
 *
 * Usage:
 *   node run-pvs-check.js [projectDir] [-- extra pvs-js analyze flags]
 *
 * Flags:
 *   --full            Analyze the whole project instead of scoping to
 *                      changed files (also the automatic fallback when the
 *                      project isn't a git repo).
 *
 * Anything after a literal `--` is passed straight through to
 * `pvs-js analyze` (e.g. `-- --rules OWASP=on` or `-- --file-analysis-timeout 30m`).
 *
 * Exit codes (mirrors pvs-js's own exit codes — see references/pvs-js-cli.md):
 *   0   clean, or nothing to analyze
 *   1   warnings found — see the printed summary
 *   2   invalid analyzer configuration — don't retry, fix the config
 *   3   unexpected internal pvs-js error — don't retry, report it
 *   4   all files were excluded from analysis (check analysis-paths/config)
 *   5   some files failed to analyze (parsing error) — coverage is incomplete
 *   6   some files timed out — coverage is incomplete
 *   20  license expired — stop, this needs a human
 *   21  license expiring within a month — analysis still ran, but flag it
 *   22  license missing or invalid — stop, this needs a human
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function parseArgs(argv) {
  const dashDashIndex = argv.indexOf("--");
  const ownArgs = dashDashIndex === -1 ? argv : argv.slice(0, dashDashIndex);
  const passthrough = dashDashIndex === -1 ? [] : argv.slice(dashDashIndex + 1);

  const full = ownArgs.includes("--full");
  const positional = ownArgs.filter(
    (a) => a !== "--full" && !a.startsWith("--"),
  );
  const projectDir = path.resolve(positional[0] || ".");

  return { projectDir, full, passthrough };
}

function collectChangedFiles(projectDir) {
  const collectorPath = path.join(__dirname, "collect-changed-files.js");
  const result = spawnSync(process.execPath, [collectorPath, projectDir], {
    encoding: "utf8",
  });

  if (result.status === 2) {
    // Not a git repo — signal caller to fall back to a full scan.
    return null;
  }
  if (result.error || result.status !== 0) {
    process.stderr.write(
      "Could not determine changed files:\n" + (result.stderr || "") + "\n",
    );
    return null;
  }
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    /* best-effort cleanup */
  }
}

const PVS_JS_BIN = process.platform === "win32" ? "pvs-js.exe" : "pvs-js";

function runPvsJs(projectDir, sourceFilesPath, outputPath, passthrough) {
  const args = [
    "analyze",
    projectDir,
    "--output",
    outputPath,
    "--indicate-warnings",
    "--no-noise",
  ];
  if (sourceFilesPath) {
    args.push("--source-files", sourceFilesPath);
  }
  args.push(...passthrough);

  return spawnSync(PVS_JS_BIN, args, { encoding: "utf8" });
}

function formatWarnings(report, projectDir) {
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const byFile = new Map();

  for (const w of warnings) {
    const positions =
      Array.isArray(w.positions) && w.positions.length > 0 ? w.positions : [{}];
    const primary = positions[0];
    const file = primary.file
      ? path.relative(projectDir, primary.file)
      : "(unknown file)";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({
      line: primary.line ?? "?",
      column: primary.column ?? "?",
      code: w.code ?? "?",
      level: w.level ?? "?",
      message: w.message ?? "(no message)",
    });
  }

  const lines = [];
  for (const [file, items] of [...byFile.entries()].sort()) {
    lines.push(file + ":");
    items
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
      .forEach((item) => {
        lines.push(
          `  ${item.line}:${item.column}  [${item.code}] (level ${item.level})  ${item.message}`,
        );
      });
  }
  lines.push("");
  lines.push(`Total: ${warnings.length} warning(s) in ${byFile.size} file(s).`);
  return lines.join("\n");
}

// What to do for each pvs-js exit code that needs special handling (see the
// header comment above for what each code means). Codes not listed here (0,
// 1) carry no special handling and fall through to report inspection below.
//   fatal    — stop immediately, exit with this code, don't retry.
//   license  — stop immediately, exit with this code, needs a human.
//   excluded — stop immediately, exit with this code.
//   partial  — note incomplete coverage, then continue to report inspection.
const EXIT_CODE_HANDLING = {
  2: { kind: "fatal", detail: "invalid analyzer configuration" },
  3: { kind: "fatal", detail: "unexpected internal pvs-js error" },
  4: { kind: "excluded" },
  5: { kind: "partial", detail: "some files failed to analyze (parse error)" },
  6: { kind: "partial", detail: "some files timed out" },
  20: { kind: "license", detail: "License expired." },
  21: {
    kind: "license",
    detail:
      "License expires within a month — analysis still ran, but this needs attention soon.",
  },
  22: { kind: "license", detail: "License missing or invalid." },
};

function main() {
  const { projectDir, full, passthrough } = parseArgs(process.argv.slice(2));

  let sourceFilesPath = null;
  let tmpSourceFile = null;

  if (!full) {
    const files = collectChangedFiles(projectDir);
    if (files === null) {
      console.log(
        "Not a git repo (or git unavailable) — falling back to a full project scan.",
      );
    } else if (files.length === 0) {
      console.log("No changed JS/TS files detected — nothing to analyze.");
      process.exit(0);
    } else {
      tmpSourceFile = path.join(
        os.tmpdir(),
        `pvs-source-files-${process.pid}.txt`,
      );
      fs.writeFileSync(tmpSourceFile, files.join(os.EOL) + os.EOL);
      sourceFilesPath = tmpSourceFile;
      console.log(`Analyzing ${files.length} changed file(s).`);
    }
  } else {
    console.log("Analyzing the whole project (--full).");
  }

  const tmpOutputFile = path.join(
    os.tmpdir(),
    `pvs-report-${process.pid}.json`,
  );
  const result = runPvsJs(
    projectDir,
    sourceFilesPath,
    tmpOutputFile,
    passthrough,
  );

  if (tmpSourceFile) safeUnlink(tmpSourceFile);

  if (result.error) {
    console.error(
      `Could not run ${PVS_JS_BIN} — is it installed and on PATH? (${result.error.message})`,
    );
    process.exit(3);
  }

  const exitCode = result.status;
  const handling = EXIT_CODE_HANDLING[exitCode];

  if (handling?.kind === "license") {
    console.error(`pvs-js license issue: ${handling.detail}`);
    console.error(
      "This needs a human to resolve (license setup, not something to retry or work around).",
    );
    if (result.stdout) console.error(result.stdout);
    process.exit(exitCode);
  }

  if (handling?.kind === "fatal") {
    console.error(
      `pvs-js reported a configuration/internal error (exit ${exitCode}): ${handling.detail}`,
    );
    console.error(result.stdout || result.stderr || "(no output)");
    process.exit(exitCode);
  }

  if (handling?.kind === "excluded") {
    console.log(
      "All targeted files were excluded from analysis (check analysis-paths / pvs-settings.toml).",
    );
    process.exit(exitCode);
  }

  const isPartial = handling?.kind === "partial";
  if (isPartial) {
    console.log(
      `pvs-js finished with exit ${exitCode}: ${handling.detail}. ` +
        "Coverage is incomplete for those files — continuing.",
    );
  }

  if (!fs.existsSync(tmpOutputFile)) {
    console.log("pvs-js finished but produced no report file.");
    process.exit(exitCode);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(tmpOutputFile, "utf8"));
  } catch (e) {
    console.error(`Could not parse PVS-Studio.json report: ${e.message}`);
    console.error(
      "The report schema may have changed — check references/pvs-js-cli.md.",
    );
    process.exit(3);
  } finally {
    safeUnlink(tmpOutputFile);
  }

  const warningCount = Array.isArray(report.warnings)
    ? report.warnings.length
    : 0;

  if (warningCount === 0) {
    console.log("Clean — no warnings.");
    process.exit(isPartial ? exitCode : 0);
  }

  console.log(formatWarnings(report, projectDir));
  process.exit(1);
}

main();
