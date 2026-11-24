// Renders reports: as text for a person, JSON for a program, or GitHub Actions
// workflow commands, which annotate the catalog's lines in a pull request.

import { VIA_TEXT } from "./discover.ts";
import { loadRegistry } from "./registry.ts";
import { LEVEL_NAMES, type Report, type Result } from "./run.ts";

/** How much of the spec's registry the suite checks. */
export function coverage() {
  const { requirements } = loadRegistry();
  return {
    total: requirements.length,
    checked: requirements.filter((r) => r.check).length,
    pending: requirements.filter((r) => r.pending).length,
    excluded: requirements.filter((r) => r.excluded).length,
  };
}

export interface TextOptions {
  /** Every result, grouped, passing ones too, with every finding. */
  verbose?: boolean;
  /** ANSI color, for a terminal. */
  color?: boolean;
}

type Paint = (s: string) => string;

function painter(on: boolean) {
  const sgr = (code: number): Paint => (on ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => s);
  return { red: sgr(31), green: sgr(32), yellow: sgr(33), cyan: sgr(36), dim: sgr(2), bold: sgr(1) };
}

/** Findings shown per requirement by default; --verbose, JSON and annotations show all of them. */
const TEXT_FINDINGS = 5;

const PROBLEMS: ReadonlySet<Result["status"]> = new Set(["fail", "warn", "notice", "expected"]);

/** The groups a verbose report shows requirements in, by spec section. */
const GROUPS: [string, string[]][] = [
  [
    "Catalog",
    ["top-level-structure", "host-info", "producer-behavior", "location-independence", "no-stability-guarantee", "format-and-key-naming", "privacy-considerations"],
  ],
  [
    "Entries",
    ["catalog-entry", "multi-version-entries", "publisher-object", "identifier-typosquatting", "digest-format", "policy-urls-extension", "verifying-artifact-integrity"],
  ],
  [
    "Trust Manifests",
    ["trust-manifest", "contributor-identity", "manifest-validity", "optional-members", "subject-object", "trust-schema-object", "attestation-object", "provenance-link-object"],
  ],
  [
    "Signatures",
    ["signature-object", "profile-selection", "signed-payload-and-jws-construction", "the-did-web-signer-profile", "jws-algorithm-and-key-requirements"],
  ],
  ["Types (CDDL)", ["cddl-schema"]],
];

export function groupOf(section: string): string {
  return GROUPS.find(([, sections]) => sections.includes(section))?.[0] ?? "Other";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function text(report: Report, options: TextOptions = {}): string {
  const verbose = options.verbose === true;
  const p = painter(options.color === true);
  const MARK: Record<Result["status"], string> = {
    pass: p.green("✓"),
    fail: p.red("✗"),
    warn: p.yellow("!"),
    notice: p.cyan("i"),
    "n/a": p.dim("·"),
    skipped: p.dim("·"),
    expected: p.yellow("~"),
  };
  const lines: string[] = [];

  lines.push(p.bold(`AI Catalog ${report.spec.version} · ${report.source}`));
  if (report.discovery && report.discovery.via !== "direct") {
    lines.push(p.dim(`found via ${VIA_TEXT[report.discovery.via]} on ${report.discovery.from}`));
  }
  lines.push("");

  // A document that is not a catalog has nothing else to report.
  if (report.notCatalog) {
    lines.push(`${p.red("✗")} ${p.bold("Not an AI Catalog")}: ${report.notCatalog}`);
    return lines.join("\n");
  }

  lines.push(verdict(report, p));
  if (report.fetched) {
    const live = report.results.filter((r) => r.mode === "fetch");
    const failed = live.filter((r) => r.status === "fail").length;
    const warned = live.filter((r) => r.status === "warn").length;
    const parts = [failed ? p.red(`${failed} failed`) : "", warned ? p.yellow(plural(warned, "warning")) : ""].filter(Boolean);
    lines.push(`  ${p.dim("live copy and artifacts:")} ${parts.length ? parts.join(", ") : p.green("all checks pass")} ${p.dim("(not counted in the level)")}`);
  }

  const problems = report.results.filter((r) => PROBLEMS.has(r.status));
  // Columns fit the rows shown: every result in verbose, only the problems otherwise.
  const shownRows = verbose ? report.results : problems;
  const idWidth = Math.max(0, ...shownRows.map((r) => r.id.length));
  const titleWidth = Math.max(0, ...shownRows.map((r) => r.title.length));
  const row = (r: Result, tag: string = r.strength) =>
    `${MARK[r.status]} ${r.id.padEnd(idWidth)}  ${r.title.padEnd(titleWidth)}  ${p.dim(tag)}`;
  const details = (r: Result, indent: string) => {
    const out: string[] = [];
    const shown = verbose ? r.findings : r.findings.slice(0, TEXT_FINDINGS);
    for (const f of shown) {
      const where = [f.line === undefined ? "" : `line ${f.line}`, f.at].filter(Boolean).join("  ");
      out.push(`${indent}${where ? `${p.dim(where)}  ` : ""}${f.message}`);
    }
    if (shown.length < r.findings.length) out.push(`${indent}${p.dim(`and ${r.findings.length - shown.length} more (--verbose lists every one)`)}`);
    if (r.status === "expected") out.push(`${indent}${p.dim(`expected: ${r.reason}`)}`);
    if (PROBLEMS.has(r.status)) out.push(`${indent}${p.dim(r.link)}`);
    return out;
  };

  if (!verbose) {
    for (const r of problems) {
      lines.push("", `  ${row(r)}`, ...details(r, "      "));
    }
  } else {
    const needFetch = report.results.filter((r) => r.status === "skipped");
    for (const [group] of [...GROUPS, ["Other", []] as [string, string[]]]) {
      const inGroup = report.results.filter((r) => groupOf(r.section) === group && r.status !== "skipped");
      if (inGroup.length === 0) continue;
      lines.push("", p.bold(group));
      if (inGroup.every((r) => r.status === "n/a")) {
        lines.push(`  ${MARK["n/a"]} ${p.dim(`${plural(inGroup.length, "requirement")}, none applicable to this catalog`)}`);
        continue;
      }
      for (const r of inGroup) {
        lines.push(`  ${row(r, r.status === "n/a" ? "n/a" : r.strength)}`, ...details(r, "      "));
      }
    }
    if (needFetch.length > 0) {
      lines.push("", p.bold("Needs --fetch"), `  ${MARK.skipped} ${p.dim(needFetch.map((r) => r.id).join(", "))}`);
    }
  }

  for (const { id, why } of report.staleBaseline) {
    lines.push("", `${p.red("✗")} baseline entry ${id} ${why}`);
  }

  const c = report.counts;
  const summary = [
    c.pass ? p.green(`${c.pass} passed`) : "",
    c.fail ? p.red(`${c.fail} failed`) : "",
    c.warn ? p.yellow(plural(c.warn, "warning")) : "",
    c.notice ? p.cyan(plural(c.notice, "notice")) : "",
    c.expected ? p.yellow(`${c.expected} expected`) : "",
    c["n/a"] ? `${c["n/a"]} not applicable` : "",
    c.skipped ? `${c.skipped} need --fetch` : "",
  ].filter(Boolean);
  lines.push("", summary.join(p.dim(" · ")));
  if (verbose) {
    const cov = coverage();
    lines.push(
      p.dim(
        `Level 3 (Trusted) is not assessed. The suite checks ${cov.checked} of the spec's ${cov.total} requirements; ` +
          `${cov.pending} are pending and ${cov.excluded} cannot be checked from a catalog (COVERAGE.md lists each).`,
      ),
    );
  }
  return lines.join("\n");
}

function verdict(report: Report, p: ReturnType<typeof painter>): string {
  const mustFails = report.results.filter(
    (r) => r.mode === "document" && (r.status === "fail" || r.status === "expected") && r.strength.startsWith("MUST"),
  ).length;
  if (report.level === 0) return `${p.red("✗")} ${p.bold("Not conformant")}: ${plural(mustFails, "MUST fails", "MUSTs fail")}`;
  const warnings = report.results.filter((r) => r.mode === "document" && r.status === "warn").length;
  const level = `${p.green("✓")} ${p.bold(`Conforms at ${LEVEL_NAMES[report.level]}`)}`;
  return warnings ? `${level} ${p.dim("·")} ${p.yellow(plural(warnings, "warning"))}` : level;
}

export function json(report: Report): string {
  return JSON.stringify({ ...report, coverage: coverage() }, null, 2);
}

// Workflow command values escape %, CR and LF; properties also escape : and ,.
const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One annotation per finding, then the text report. `file` is the path to annotate. */
export function github(report: Report, file: string | undefined, options: TextOptions = {}): string {
  const commands: string[] = [];
  const LEVEL: Partial<Record<Result["status"], string>> = { fail: "error", warn: "warning", notice: "notice" };
  if (report.notCatalog) {
    commands.push(`::error ${file ? `file=${escapeProperty(file)},` : ""}title=${escapeProperty("Not an AI Catalog")}::${escapeData(report.notCatalog)}`);
  }
  for (const r of report.results) {
    const level = LEVEL[r.status];
    if (!level || report.notCatalog) continue;
    for (const f of r.findings) {
      const props = [
        file ? `file=${escapeProperty(file)}` : undefined,
        file && f.line !== undefined ? `line=${f.line}` : undefined,
        `title=${escapeProperty(`${r.id} ${r.title} (${r.strength})`)}`,
      ].filter(Boolean);
      const body = `${f.at === "" ? "" : `${f.at}: `}${f.message}\n${r.link}`;
      commands.push(`::${level} ${props.join(",")}::${escapeData(body)}`);
    }
  }
  return [...commands, text(report, { ...options, color: false })].join("\n");
}
