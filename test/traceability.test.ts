// The registry is the spec, numbered: nothing missed, nothing invented, and each
// entry either checked by code that exists, pending, or excluded with a reason.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { coverageMarkdown } from "../src/coverage.ts";
import { strengthOf } from "../src/extract.ts";
import { loadRegistry, SPEC_VERSIONS, specPath } from "../src/registry.ts";
import { implementedIds } from "../src/run.ts";
import { sync } from "../src/sync.ts";

for (const version of SPEC_VERSIONS) {
  describe(`requirements/${version}.yaml`, () => {
    const registry = loadRegistry(version);
    const all = registry.requirements;
    const ids = new Set(all.map((r) => r.id));

    it("holds every normative statement of the vendored spec, word for word", () => {
      assert.deepEqual(sync(readFileSync(specPath(version), "utf8"), version), { missing: [], stale: [], moved: [] });
    });

    it("gives each requirement a unique ID", () => {
      assert.equal(ids.size, all.length);
    });

    it("numbers each statement under its section's prefix", () => {
      for (const r of registry.requirements) {
        const prefix = r.id.replace(/-[^-]+$/, "");
        assert.equal(registry.sections[prefix], r.section, r.id);
      }
    });

    it("records each statement's strength as its keywords give it", () => {
      for (const r of registry.requirements.filter((x) => !x.definition && (!x.id.startsWith("CDDL-") || x.id === "CDDL-1"))) {
        assert.equal(r.strength, strengthOf(r.text), r.id);
      }
    });

    it("gives each requirement exactly one disposition", () => {
      for (const r of all) {
        const n = Number(!!r.check) + Number(!!r.pending) + Number(!!r.excluded);
        assert.equal(n, 1, r.id);
        if (r.pending) assert.ok(r.reason, `${r.id} is pending without a reason`);
      }
    });

    it("implements exactly the checked requirements", () => {
      const checked = all.filter((r) => r.check).map((r) => r.id).sort();
      assert.deepEqual([...implementedIds()].sort(), checked);
    });

    it("refers only to IDs that exist", () => {
      for (const r of all) {
        for (const ref of `${r.excluded ?? ""} ${r.note ?? ""}`.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
          assert.ok(ids.has(ref), `${r.id} refers to ${ref}, which does not exist`);
        }
      }
    });
  });
}

it("COVERAGE.md is current (npm run coverage)", () => {
  assert.equal(readFileSync(new URL("../COVERAGE.md", import.meta.url), "utf8"), coverageMarkdown());
});
