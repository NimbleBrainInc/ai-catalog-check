// Runs every checked requirement against one catalog document.

import { documentChecks } from "./checks/document.ts";
import { cachingFetcher, fetchChecks } from "./checks/fetch.ts";
import { signatureChecks } from "./checks/signature.ts";
import type { DocumentCheck, FetchCheck, Fetched, JsonObject, Outcome } from "./checks/types.ts";
import { isObject } from "./checks/walk.ts";
import type { Via } from "./discover.ts";
import { lineOf, type Parsed, parseJson } from "./json.ts";
import { isSupported, LATEST_SPEC, loadRegistry, type Mode, type Requirement, SPEC_VERSIONS, specLink } from "./registry.ts";
import { specFacts } from "./spec-facts.ts";

export type Status = "pass" | "fail" | "warn" | "notice" | "n/a" | "skipped" | "expected";

export interface Finding {
  at: string;
  line?: number;
  message: string;
}

export interface Result {
  id: string;
  /** A short name for what the requirement asks. */
  title: string;
  /** The spec section the requirement is in. */
  section: string;
  strength: Requirement["strength"];
  /** Whether the check read the document alone or fetched the catalog and its artifacts. */
  mode: Mode;
  status: Status;
  findings: Finding[];
  /** The requirement's section in the published spec. */
  link: string;
  /** The spec's sentence the requirement checks. */
  text: string;
  /** What the check takes the sentence to cover, when the sentence alone does not say. */
  note?: string;
  /** Why it was skipped, or why a failure is expected. */
  reason?: string;
}

export interface StaleBaseline {
  id: string;
  why: string;
}

export interface Baseline {
  expected: { id: string; reason: string }[];
}

export interface RunOptions {
  /** The catalog's text. */
  text: string;
  /** A file path or URL naming the catalog in the report. */
  source: string;
  /** Run the checks that fetch the catalog's URL and its artifacts. */
  fetch?: boolean;
  /** The URL the catalog was fetched from; relative entry URLs resolve against it. */
  catalogUrl?: string;
  catalogResponse?: Fetched;
  fetcher?: (url: string) => Promise<Fetched>;
  baseline?: Baseline;
  /** How the catalog was found, when discovery found it from another URL. */
  discovery?: { from: string; via: Via };
  /** Fail on warnings as well as failures. */
  strict?: boolean;
  /**
   * The spec version to check against. By default the catalog's own `specVersion`
   * picks it; given, it must be one this release checks.
   */
  spec?: string;
}

/** How the spec version a report checks against was chosen. */
export type SpecChoice = "declared" | "requested" | "latest";

export interface Report {
  source: string;
  /** How the catalog was found, when discovery found it from another URL. */
  discovery?: { from: string; via: Via };
  /** Why the document is not an AI Catalog at all, when it is not a JSON object. */
  notCatalog?: string;
  /**
   * Set when the catalog declares a spec version this release does not check; the
   * catalog was not checked, and `results` is empty.
   */
  unsupportedSpec?: { declared: string; supported: readonly string[] };
  /**
   * The spec version checked against, and how it was chosen: the catalog's own
   * `specVersion`, the one asked for (--spec), or the newest this release checks,
   * when the catalog names none it can.
   */
  spec: { version: string; commit: string; chosen: SpecChoice };
  fetched: boolean;
  /**
   * The document's conformance level: 0 when a MUST checked from the document fails,
   * 1 Minimal, 2 Discoverable. Level 3 is not assessed. It is the document's alone,
   * so it is the same with or without --fetch; what fetching finds is in `results`
   * (mode `fetch`) and in `failed`.
   */
  level: 0 | 1 | 2;
  results: Result[];
  counts: Record<Status, number>;
  /** Baseline entries that cover nothing: the requirement passes, or is not one the suite checks. */
  staleBaseline: StaleBaseline[];
  failed: boolean;
}

export const LEVEL_NAMES = ["not conformant", "Level 1 (Minimal)", "Level 2 (Discoverable)"] as const;

/**
 * The checks, filed under their mode. The runner looks a requirement's check up
 * under the mode the registry gives it, so a check filed under the other mode is
 * never run as this one: a fetch check cannot run without --fetch.
 */
export const CHECKS: { document: Record<string, DocumentCheck>; fetch: Record<string, FetchCheck> } = {
  document: { ...documentChecks, ...signatureChecks },
  fetch: fetchChecks,
};

export class UnsupportedSpecError extends Error {}

export async function run(options: RunOptions): Promise<Report> {
  let parsed: Parsed | undefined;
  let syntax: string | undefined;
  try {
    parsed = parseJson(options.text);
  } catch (error) {
    syntax = (error as Error).message;
  }
  const catalog = parsed && isObject(parsed.value) ? (parsed.value as JsonObject) : undefined;

  // The version to check against: the one asked for, else the catalog's own when
  // this release checks it. A well-formed version it does not check is answered,
  // not checked. A missing or malformed one is checked against the newest version,
  // where TOP-1, CDDL-AICatalog and SVPROD-1 report it.
  const declared = typeof catalog?.specVersion === "string" ? catalog.specVersion : undefined;
  let specVersion: string;
  let chosen: SpecChoice;
  if (options.spec !== undefined) {
    if (!isSupported(options.spec)) {
      throw new UnsupportedSpecError(`AI Catalog ${options.spec} is not a version this release checks (${SPEC_VERSIONS.join(", ")})`);
    }
    specVersion = options.spec;
    chosen = "requested";
  } else if (declared !== undefined && isSupported(declared)) {
    specVersion = declared;
    chosen = "declared";
  } else if (declared !== undefined && /^\d+\.\d+$/.test(declared)) {
    return unsupported(options, declared);
  } else {
    specVersion = LATEST_SPEC;
    chosen = "latest";
  }

  const registry = loadRegistry(specVersion);
  const facts = specFacts(specVersion);
  // One fetcher for the run, so each URL is asked for once across every check.
  const fetcher = options.fetcher ?? cachingFetcher();
  const requirements = registry.requirements.filter((r) => r.check);

  const results: Result[] = [];
  for (const r of requirements) {
    const mode = r.check!;
    const base = { id: r.id, title: r.title ?? r.id, section: r.section, strength: r.strength, mode, link: specLink(registry, r), text: r.text, ...(r.note ? { note: r.note } : {}) };
    if (!catalog || !parsed) {
      if (r.id === "TOP-1") {
        const message = syntax ? `The document is not JSON: ${syntax}` : "The document is not a JSON object";
        results.push({ ...base, status: "fail", findings: [{ at: "", message }] });
      } else {
        results.push({ ...base, status: "skipped", findings: [], reason: "The document is not a JSON object." });
      }
      continue;
    }
    if (mode === "fetch" && !options.fetch) {
      results.push({ ...base, status: "skipped", findings: [], reason: "Needs --fetch." });
      continue;
    }
    const check = CHECKS[mode][r.id];
    if (!check) throw new Error(`${r.id} is marked \`check: ${mode}\` and has no ${mode} check`);
    const ctx = {
      catalog,
      parsed,
      specVersion,
      facts,
      catalogUrl: options.catalogUrl,
      catalogResponse: options.catalogResponse,
      fetch: fetcher,
    };
    const outcome: Outcome = await check(ctx);
    results.push({ ...base, ...statusOf(r, outcome, parsed) });
  }

  // A baseline entry covers a failure or a warning. One that covers nothing, or
  // names no checked requirement, fails the run, so the baseline only shrinks.
  const staleBaseline: StaleBaseline[] = [];
  for (const { id, reason } of options.baseline?.expected ?? []) {
    const result = results.find((x) => x.id === id);
    if (!result) {
      staleBaseline.push({ id, why: "is not a requirement this suite checks" });
    } else if (result.status === "fail" || result.status === "warn") {
      result.status = "expected";
      result.reason = reason;
    } else if (result.status !== "skipped") {
      staleBaseline.push({ id, why: "no longer fails or warns; remove it from the baseline" });
    }
  }

  const documentFailed = results.some(
    (x) => x.mode === "document" && (x.status === "fail" || x.status === "expected") && x.strength.startsWith("MUST"),
  );
  const host = catalog && isObject(catalog.host) && typeof catalog.host.displayName === "string";
  const level = !catalog || documentFailed ? 0 : host ? 2 : 1;

  const counts = Object.fromEntries(
    (["pass", "fail", "warn", "notice", "n/a", "skipped", "expected"] as Status[]).map((s) => [
      s,
      results.filter((x) => x.status === s).length,
    ]),
  ) as Record<Status, number>;

  const failed =
    counts.fail > 0 || staleBaseline.length > 0 || (options.strict === true && counts.warn > 0);

  return {
    source: options.source,
    ...(options.discovery ? { discovery: options.discovery } : {}),
    ...(catalog ? {} : { notCatalog: syntax ? `it is not JSON: ${syntax}` : "it is JSON, but not an object" }),
    spec: { version: registry.spec.version, commit: registry.spec.commit, chosen },
    fetched: options.fetch === true,
    level,
    results,
    counts,
    staleBaseline,
    failed,
  };
}

function unsupported(options: RunOptions, declared: string): Report {
  const latest = loadRegistry(LATEST_SPEC);
  return {
    source: options.source,
    ...(options.discovery ? { discovery: options.discovery } : {}),
    unsupportedSpec: { declared, supported: SPEC_VERSIONS },
    spec: { version: latest.spec.version, commit: latest.spec.commit, chosen: "latest" },
    fetched: options.fetch === true,
    level: 0,
    results: [],
    counts: { pass: 0, fail: 0, warn: 0, notice: 0, "n/a": 0, skipped: 0, expected: 0 },
    staleBaseline: [],
    failed: true,
  };
}

function statusOf(r: Requirement, outcome: Outcome, parsed: Parsed): Pick<Result, "status" | "findings"> {
  if (outcome === "n/a") return { status: "n/a", findings: [] };
  if (outcome.length === 0) return { status: "pass", findings: [] };
  const findings = outcome.map((v) => {
    const line = lineOf(parsed.lines, v.at);
    return { at: v.at, message: v.message, ...(line === undefined ? {} : { line }) };
  });
  if (outcome.every((v) => v.notice)) return { status: "notice", findings };
  return { status: r.strength.startsWith("MUST") ? "fail" : "warn", findings };
}
