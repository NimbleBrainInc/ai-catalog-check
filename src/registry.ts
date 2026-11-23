// Loads the requirement registry for a spec version.

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

export const SPEC_VERSIONS = ["0.9"] as const;

// `src/` and `dist/` both sit one level below the package root.
const root = new URL("../", import.meta.url);

export function specPath(version: string): URL {
  return new URL(`spec/${version}/ai-catalog.md`, root);
}

export function loadRegistry(version: string): Registry {
  if (!(SPEC_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(`no registry for AI Catalog ${version}; this suite covers ${SPEC_VERSIONS.join(", ")}`);
  }
  const raw = YAML.parse(readFileSync(new URL(`requirements/${version}.yaml`, root), "utf8")) as {
    spec: SpecInfo;
    sections: Record<string, string>;
    requirements: Requirement[];
  };
  return raw;
}


/** The link to a requirement's section in the published spec. */
export function specLink(registry: Registry, requirement: Requirement): string {
  return `${registry.spec.published}#${requirement.section}`;
}
