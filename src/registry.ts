// Loads the requirement registry for a spec version and any profiles on top of it.

import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { Strength } from "./extract.ts";

/** How a checked requirement is checked: from the document alone, or by fetching. */
export type Mode = "document" | "fetch";

export interface Requirement {
  id: string;
  /** The spec section's anchor. Absent for a profile's requirements. */
  section?: string;
  strength: Strength;
  role: string;
  level?: number;
  /** The spec's sentence word for word, or a profile's statement. */
  text: string;
  note?: string;
  /** Normative without a keyword (a definition the spec states), enforced as a MUST. */
  definition?: boolean;
  check?: Mode;
  pending?: "document" | "verify";
  reason?: string;
  excluded?: string;
  /** `spec`, or the name of the profile that defines it. */
  source: string;
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
export const PROFILES = ["nimblebrain"] as const;

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
    requirements: Omit<Requirement, "source">[];
  };
  return { ...raw, requirements: raw.requirements.map((r) => ({ ...r, source: "spec" })) };
}

export function loadProfile(name: string): Requirement[] {
  if (!(PROFILES as readonly string[]).includes(name)) {
    throw new Error(`no profile "${name}"; this suite has ${PROFILES.join(", ")}`);
  }
  const raw = YAML.parse(readFileSync(new URL(`profiles/${name}.yaml`, root), "utf8")) as {
    requirements: Omit<Requirement, "source">[];
  };
  return raw.requirements.map((r) => ({ ...r, source: name }));
}

/** The link to a requirement's section in the published spec. */
export function specLink(registry: Registry, requirement: Requirement): string | undefined {
  return requirement.section ? `${registry.spec.published}#${requirement.section}` : undefined;
}
