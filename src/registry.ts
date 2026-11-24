// Loads the requirement registries, one per spec version.
//
// Each supported version has its requirements in `requirements/<version>.yaml` and
// the spec text they quote in `spec/<version>/`. Adding a version is adding those
// two; the list of supported versions is whatever `requirements/` holds. A
// requirement ID keeps one meaning in every version: a statement that changes
// meaning gets a new ID, so a check never has to know which version it runs under.

import { readdirSync, readFileSync } from "node:fs";
import YAML from "yaml";
import type { Strength } from "./extract.ts";

/** How a checked requirement is checked: from the document alone, or by fetching. */
export type Mode = "document" | "fetch";

export interface Requirement {
  id: string;
  /** A short name for what the requirement asks, on every checked requirement. */
  title?: string;
  /** The spec section's anchor. */
  section: string;
  strength: Strength;
  role: string;
  level?: number;
  /** The spec's sentence, word for word. */
  text: string;
  note?: string;
  /** Normative without a keyword (a definition the spec states), enforced as a MUST. */
  definition?: boolean;
  check?: Mode;
  pending?: "document" | "verify";
  reason?: string;
  excluded?: string;
}

export interface SpecInfo {
  title: string;
  version: string;
  status: string;
  source: string;
  commit: string;
  tag: string;
  published: string;
  license: string;
}

export interface Registry {
  spec: SpecInfo;
  sections: Record<string, string>;
  requirements: Requirement[];
}

// `src/` and `dist/` both sit one level below the package root.
const root = new URL("../", import.meta.url);

const byVersion = (a: string, b: string) => {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am! - bm! || an! - bn!;
};

/** The spec versions this release checks, oldest first. */
export const SPEC_VERSIONS: readonly string[] = readdirSync(new URL("requirements/", root))
  .filter((f) => /^\d+\.\d+\.yaml$/.test(f))
  .map((f) => f.slice(0, -".yaml".length))
  .sort(byVersion);

/** The newest spec version this release checks. */
export const LATEST_SPEC = SPEC_VERSIONS.at(-1)!;

export function isSupported(version: string): boolean {
  return SPEC_VERSIONS.includes(version);
}

function checkVersion(version: string) {
  if (!isSupported(version)) {
    throw new Error(`AI Catalog ${version} is not a version this release checks (${SPEC_VERSIONS.join(", ")})`);
  }
}

/** The vendored spec's Markdown for a version. */
export function specPath(version: string): URL {
  checkVersion(version);
  return new URL(`spec/${version}/ai-catalog.md`, root);
}

/** The vendored spec's example catalog for a version. */
export function specExamplePath(version: string): URL {
  checkVersion(version);
  return new URL(`spec/${version}/examples/ai-catalog.json`, root);
}

const cached = new Map<string, Registry>();

export function loadRegistry(version: string): Registry {
  checkVersion(version);
  let registry = cached.get(version);
  if (!registry) {
    registry = YAML.parse(readFileSync(new URL(`requirements/${version}.yaml`, root), "utf8")) as Registry;
    if (registry.spec.version !== version) {
      throw new Error(`requirements/${version}.yaml says it covers AI Catalog ${registry.spec.version}`);
    }
    cached.set(version, registry);
  }
  return registry;
}

/** The link to a requirement's section in the published spec. */
export function specLink(registry: Registry, requirement: Requirement): string {
  return `${registry.spec.published}#${requirement.section}`;
}
