// The spec's example catalogs, and the ones the spec gets wrong.

import { readFileSync } from "node:fs";
import { SPEC_VERSIONS, specExamplePath, specPath } from "../src/registry.ts";

/**
 * Spec examples a MUST rightly rejects, keyed by "<version> <example> <requirement>":
 * what the spec gets wrong. Each is a bug to report to the spec, not to the suite.
 */
export const KNOWN_SPEC_ERRORS: Record<string, string> = {
  "0.9 Example: Multi-Artifact Catalog with Nested Catalog #1 SIG-5":
    "The example's `jws` ends in the placeholder `detached-jws-signature`, which is not canonical base64url (nor the 64 bytes of an ES256 signature).",
  "0.9 examples/ai-catalog.json SIG-5":
    "The same placeholder signature as the spec's multi-artifact example, of which this file is a copy.",
};

/** The complete example catalogs in the spec's Markdown, named by heading. */
export function examples(markdown: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  let heading = "";
  let n = 0;
  for (const m of markdown.matchAll(/^(#+ .*)$|^```json\n([\s\S]*?)^```$/gm)) {
    if (m[1]) {
      heading = m[1].replace(/^#+\s*/, "");
      n = 0;
      continue;
    }
    const text = m[2]!;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue; // a fragment, not a document
    }
    if (typeof value === "object" && value && "specVersion" in value && "entries" in value) {
      n++;
      out.push({ name: `${heading} #${n}`, text });
    }
  }
  return out;
}

/** Every vendored spec version's example catalogs, named "<version> <example>". */
export function specExamples(): { version: string; name: string; text: string }[] {
  return SPEC_VERSIONS.flatMap((version) =>
    [
      ...examples(readFileSync(specPath(version), "utf8")),
      { name: "examples/ai-catalog.json", text: readFileSync(specExamplePath(version), "utf8") },
    ].map((e) => ({ version, name: `${version} ${e.name}`, text: e.text })),
  );
}
