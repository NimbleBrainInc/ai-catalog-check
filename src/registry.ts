// Loads the requirement registry: the spec's normative statements, numbered.
//
// A release of this suite checks one version of the spec, the one
// `requirements.yaml` names. The spec text it was built from is vendored in
// `spec/`. A new spec version replaces both and starts a new major release.

import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { Strength } from "./extract.ts";

/** How a checked requirement is checked: from the document alone, or by fetching. */
export type Mode = "document" | "fetch";

export interface Requirement {
  id: string;
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

/** The vendored spec's Markdown. */
export const specPath = new URL("spec/ai-catalog.md", root);

/** The vendored spec's example catalog. */
export const specExamplePath = new URL("spec/examples/ai-catalog.json", root);

export const registryPath = new URL("requirements.yaml", root);

let cached: Registry | undefined;

export function loadRegistry(): Registry {
  cached ??= YAML.parse(readFileSync(registryPath, "utf8")) as Registry;
  return cached;
}

/** The link to a requirement's section in the published spec. */
export function specLink(registry: Registry, requirement: Requirement): string {
  return `${registry.spec.published}#${requirement.section}`;
}
