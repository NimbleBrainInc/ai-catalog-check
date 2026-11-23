// Cross-checks the suite against Vercel's TypeScript SDK for the spec: whatever
// the SDK rejects, the suite must fail on a MUST of the spec too, so nothing the
// SDK catches slips past. The suite may fail more (it checks `specVersion`, which
// the SDK does not), so the reverse is not required.
//
// Runs when the SDK is built (`node scripts/build-sdk.ts`, which CI does);
// skipped otherwise.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { run } from "../src/run.ts";
import { sdkDir } from "../scripts/build-sdk.ts";
import { CASES, COMPLETE, mutated } from "./cases.ts";
import { specExamples } from "./spec-examples.ts";

const built = existsSync(`${sdkDir}.built`);

interface Sdk {
  parseCatalogJson(text: string): unknown;
  assertValidCatalog(catalog: unknown): void;
}

async function sdkRejects(sdk: Sdk, text: string): Promise<string | undefined> {
  try {
    sdk.assertValidCatalog(sdk.parseCatalogJson(text));
    return undefined;
  } catch (error) {
    const issues = (error as { issues?: { path?: unknown[]; message: string }[] }).issues;
    return issues ? issues.map((i) => `${(i.path ?? []).join(".")}: ${i.message}`).join("; ") : (error as Error).message;
  }
}

describe("the SDK's verdicts", { skip: built ? false : "SDK not built; run node scripts/build-sdk.ts" }, async () => {
  const sdk = built ? ((await import(pathToFileURL(join(sdkDir, "dist", "index.js")).href)) as Sdk) : undefined;
  const corpus = [
    { name: "complete.json", text: COMPLETE },
    ...CASES.map((c) => ({ name: `${c.id}: ${c.why}`, text: mutated(c) })),
    ...specExamples(),
  ];

  for (const doc of corpus) {
    it(`${doc.name}: if the SDK rejects it, a MUST fails`, async () => {
      const rejected = await sdkRejects(sdk!, doc.text);
      if (!rejected) return;
      const report = await run({ text: doc.text, source: doc.name });
      const mustFailed = report.results.some((r) => r.status === "fail" && r.strength.startsWith("MUST"));
      assert.ok(mustFailed, `the SDK rejects it (${rejected}) and no MUST of the spec fails`);
    });
  }
});
