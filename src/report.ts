// Renders reports: as text for a person, JSON for a program, or GitHub Actions
// workflow commands, which annotate the catalog's lines in a pull request.

import { loadRegistry } from "./registry.ts";
import { LEVEL_NAMES, type Report, type Result } from "./run.ts";

const MARK: Record<Result["status"], string> = {
  pass: "✓",
  fail: "✗",
  warn: "!",
  notice: "i",
  "n/a": "-",
  skipped: "-",
  expected: "~",
};

/** How much of the spec's registry the suite checks. */
export function coverage(specVersion: string) {
  const { requirements } = loadRegistry(specVersion);
  return {
    total: requirements.length,
    checked: requirements.filter((r) => r.check).length,
    pending: requirements.filter((r) => r.pending).length,
    excluded: requirements.filter((r) => r.excluded).length,
  };
}

/** Findings shown per requirement in text; JSON and annotations show all of them. */
const TEXT_FINDINGS = 5;

function where(f: Result["findings"][number]): string {
  const at = f.at === "" ? "(document)" : f.at;
  return f.line === undefined ? at : `${at} (line ${f.line})`;
}

export function text(report: Report): string {
  const lines: string[] = [];
  const profiles = report.profiles.length > 0 ? ` + ${report.profiles.join(", ")}` : "";
  lines.push(`AI Catalog ${report.spec.version}${profiles}: ${report.source}`);
  lines.push(`${LEVEL_NAMES[report.level]}. Level 3 (Trusted) is not assessed.`);
  for (const r of report.results) {
    if (!["fail", "warn", "notice", "expected"].includes(r.status)) continue;
    lines.push("");
    lines.push(`${MARK[r.status]} ${r.id} ${r.strength}${r.status === "expected" ? ` (expected: ${r.reason})` : ""}`);
    for (const f of r.findings.slice(0, TEXT_FINDINGS)) lines.push(`    ${where(f)}: ${f.message}`);
    if (r.findings.length > TEXT_FINDINGS) {
      lines.push(`    and ${r.findings.length - TEXT_FINDINGS} more (--format json lists every one)`);
    }
    if (r.link) lines.push(`    ${r.link}`);
  }
  for (const id of report.staleBaseline) {
    lines.push("");
    lines.push(`✗ ${id} is in the baseline and no longer fails; remove it from the baseline`);
  }
  const c = report.counts;
  lines.push("");
  lines.push(
    `${c.pass} passed, ${c.fail} failed, ${c.warn} warnings, ${c.notice} notices, ${c.expected} expected failures, ` +
      `${c["n/a"]} not applicable, ${c.skipped} skipped${report.fetched ? "" : " (fetch checks need --fetch)"}.`,
  );
  const cov = coverage(report.spec.version);
  lines.push(
    `The suite checks ${cov.checked} of the spec's ${cov.total} requirements; ${cov.pending} are pending and ` +
      `${cov.excluded} cannot be checked from a catalog (COVERAGE.md lists each).`,
  );
  return lines.join("\n");
}

export function json(report: Report): string {
  return JSON.stringify({ ...report, coverage: coverage(report.spec.version) }, null, 2);
}

// Workflow command values escape %, CR and LF; properties also escape : and ,.
const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One annotation per finding, then the text report. `file` is the path to annotate. */
export function github(report: Report, file: string | undefined): string {
  const commands: string[] = [];
  const LEVEL: Partial<Record<Result["status"], string>> = { fail: "error", warn: "warning", notice: "notice" };
  for (const r of report.results) {
    const level = LEVEL[r.status];
    if (!level) continue;
    for (const f of r.findings) {
      const props = [
        file ? `file=${escapeProperty(file)}` : undefined,
        file && f.line !== undefined ? `line=${f.line}` : undefined,
        `title=${escapeProperty(`AI Catalog ${r.id} (${r.strength})`)}`,
      ].filter(Boolean);
      const body = `${f.at === "" ? "" : `${f.at}: `}${f.message}${r.link ? `\n${r.link}` : ""}`;
      commands.push(`::${level} ${props.join(",")}::${escapeData(body)}`);
    }
  }
  return [...commands, text(report)].join("\n");
}
