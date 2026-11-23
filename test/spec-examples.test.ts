// The spec's own example catalogs, run through the suite. An example that a
// MUST rejects is a bug in a check, or a bug in the spec (KNOWN_SPEC_ERRORS).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "../src/run.ts";
import { KNOWN_SPEC_ERRORS, specExamples } from "./spec-examples.ts";

describe("the spec's example catalogs", () => {
  const found = specExamples();

  it("are found: six in the spec, and its example file", () => {
    assert.equal(found.length, 7);
  });

  for (const example of found) {
    it(`${example.name} meets every MUST`, async () => {
      const report = await run({ text: example.text, source: example.name });
      const failing = report.results
        .filter((r) => r.status === "fail" && !KNOWN_SPEC_ERRORS[`${example.name} ${r.id}`])
        .map((r) => `${r.id}: ${r.findings.map((f) => `${f.at} ${f.message}`).join("; ")}`);
      assert.deepEqual(failing, []);
    });
  }

  it("still has every known spec error (remove the ones the spec fixes)", async () => {
    for (const key of Object.keys(KNOWN_SPEC_ERRORS)) {
      const id = key.slice(key.lastIndexOf(" ") + 1);
      const example = found.find((e) => key === `${e.name} ${id}`);
      assert.ok(example, `no example for ${key}`);
      const report = await run({ text: example.text, source: example.name });
      assert.equal(report.results.find((r) => r.id === id)?.status, "fail", key);
    }
  });
});
