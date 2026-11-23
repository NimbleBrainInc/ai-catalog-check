// Runs every checked requirement against one catalog document.

import { documentChecks } from "./checks/document.ts";
import { cachingFetcher, fetchChecks } from "./checks/fetch.ts";
import { nimblebrainChecks } from "./checks/nimblebrain.ts";
import { signatureChecks } from "./checks/signature.ts";
import type { DocumentCheck, FetchCheck, Fetched, JsonObject, Outcome } from "./checks/types.ts";
import { isObject } from "./checks/walk.ts";
import { lineOf, type Parsed, parseJson } from "./json.ts";
import { loadProfile, loadRegistry, type Registry, type Requirement, specLink } from "./registry.ts";

export type Status = "pass" | "fail" | "warn" | "notice" | "n/a" | "skipped" | "expected";

export interface Finding {
  at: string;
  line?: number;
  message: string;
}

export interface Result {
  id: string;
  /** `spec`, or the profile that defines the requirement. */
  source: string;
  strength: Requirement["strength"];
  status: Status;
  findings: Finding[];
  /** The requirement's section in the published spec. */
  link?: string;
  /** Why it was skipped, or why a failure is expected. */
  reason?: string;
}

export interface Baseline {
  expected: { id: string; reason: string }[];
}

export interface RunOptions {
  /** The catalog's text. */
  text: string;
  /** A file path or URL naming the catalog in the report. */
  source: string;
  specVersion?: string;
  profiles?: string[];
  /** Run the checks that fetch the catalog's URL and its artifacts. */
  fetch?: boolean;
  /** The URL the catalog was fetched from; relative entry URLs resolve against it. */
  catalogUrl?: string;
  catalogResponse?: Fetched;
  fetcher?: (url: string) => Promise<Fetched>;
  baseline?: Baseline;
  /** Fail on warnings as well as failures. */
  strict?: boolean;
}

export interface Report {
  source: string;
  spec: { version: string; commit: string };
  profiles: string[];
  fetched: boolean;
  /** 0 when a MUST of the spec fails; 1 Minimal; 2 Discoverable. Level 3 is not assessed. */
  level: 0 | 1 | 2;
  results: Result[];
  counts: Record<Status, number>;
  /** Baseline entries whose requirement no longer fails. */
  staleBaseline: string[];
  failed: boolean;
}

export const LEVEL_NAMES = ["not conformant", "Level 1 (Minimal)", "Level 2 (Discoverable)"] as const;

const ALL_CHECKS: Record<string, DocumentCheck | FetchCheck> = {
  ...documentChecks,
  ...signatureChecks,
  ...fetchChecks,
  ...nimblebrainChecks,
};

export function implementedIds(): Set<string> {
  return new Set(Object.keys(ALL_CHECKS));
}

export async function run(options: RunOptions): Promise<Report> {
  const specVersion = options.specVersion ?? "0.9";
  const registry = loadRegistry(specVersion);
  const profiles = options.profiles ?? [];
  const requirements = [
    ...registry.requirements,
    ...profiles.flatMap((p) => loadProfile(p)),
  ].filter((r) => r.check);

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
    const base = { id: r.id, source: r.source, strength: r.strength, ...link(registry, r) };
    if (!catalog || !parsed) {
      if (r.id === "TOP-1") {
        const message = syntax ? `The document is not JSON: ${syntax}` : "The document is not a JSON object";
        results.push({ ...base, status: "fail", findings: [{ at: "", message }] });
      } else {
        results.push({ ...base, status: "skipped", findings: [], reason: "The document is not a JSON object." });
      }
      continue;
    }
    if (r.check === "fetch" && !options.fetch) {
      results.push({ ...base, status: "skipped", findings: [], reason: "Needs --fetch." });
      continue;
    }
    const check = ALL_CHECKS[r.id];
    if (!check) throw new Error(`${r.id} is marked checked and has no check`);
    const ctx = {
      catalog,
      parsed,
      specVersion,
      catalogUrl: options.catalogUrl,
      catalogResponse: options.catalogResponse,
      fetch: options.fetcher ?? cachingFetcher(),
    };
    const outcome: Outcome = await check(ctx);
    results.push({ ...base, ...statusOf(r, outcome, parsed) });
  }

  const staleBaseline: string[] = [];
  for (const { id, reason } of options.baseline?.expected ?? []) {
    const result = results.find((x) => x.id === id);
    if (result?.status === "fail") {
      result.status = "expected";
      result.reason = reason;
    } else if (result && result.status !== "skipped") {
      staleBaseline.push(id);
    }
  }

  const specFailed = results.some(
    (x) => x.source === "spec" && (x.status === "fail" || x.status === "expected") && x.strength.startsWith("MUST"),
  );
  const host = catalog && isObject(catalog.host) && typeof catalog.host.displayName === "string";
  const level = !catalog || specFailed ? 0 : host ? 2 : 1;

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
    spec: { version: registry.spec.version, commit: registry.spec.commit },
    profiles,
    fetched: options.fetch === true,
    level,
    results,
    counts,
    staleBaseline,
    failed,
  };
}

function link(registry: Registry, r: Requirement): { link?: string } {
  const url = specLink(registry, r);
  return url ? { link: url } : {};
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
