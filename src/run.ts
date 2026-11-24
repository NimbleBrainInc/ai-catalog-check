// Runs every checked requirement against one catalog document.

import { documentChecks } from "./checks/document.ts";
import { cachingFetcher, fetchChecks } from "./checks/fetch.ts";
import { signatureChecks } from "./checks/signature.ts";
import type { DocumentCheck, FetchCheck, Fetched, JsonObject, Outcome } from "./checks/types.ts";
import { isObject } from "./checks/walk.ts";
import type { Via } from "./discover.ts";
import { lineOf, type Parsed, parseJson } from "./json.ts";
import { loadRegistry, type Mode, type Requirement, specLink } from "./registry.ts";

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
}

export interface Report {
  source: string;
  /** How the catalog was found, when discovery found it from another URL. */
  discovery?: { from: string; via: Via };
  /** Why the document is not an AI Catalog at all, when it is not a JSON object. */
  notCatalog?: string;
  spec: { version: string; commit: string };
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

export async function run(options: RunOptions): Promise<Report> {
  const registry = loadRegistry();
  const specVersion = registry.spec.version;
  // One fetcher for the run, so each URL is asked for once across every check.
  const fetcher = options.fetcher ?? cachingFetcher();
  const requirements = registry.requirements.filter((r) => r.check);

  let parsed: Parsed | undefined;
  let syntax: string | undefined;
  try {
    parsed = parseJson(options.text);
  } catch (error) {
    syntax = (error as Error).message;
  }
  const catalog = parsed && isObject(parsed.value) ? (parsed.value as JsonObject) : undefined;

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
    spec: { version: registry.spec.version, commit: registry.spec.commit },
    fetched: options.fetch === true,
    level,
    results,
    counts,
    staleBaseline,
    failed,
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
