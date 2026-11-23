// The registry is the spec, numbered: nothing missed, nothing invented, and each
// entry either checked by code that exists, pending, or excluded with a reason.
// The facts the checks read from the spec are the spec's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MEDIA_TYPES } from "../src/checks/walk.ts";
import { coverageMarkdown } from "../src/coverage.ts";
import { strengthOf } from "../src/extract.ts";
import { loadRegistry, specPath } from "../src/registry.ts";
import { CHECKS } from "../src/run.ts";
import { parseCddl, specFacts } from "../src/spec-facts.ts";
import { sync } from "../src/sync.ts";

describe("requirements.yaml", () => {
  const registry = loadRegistry();
  const all = registry.requirements;
  const ids = new Set(all.map((r) => r.id));

  it("holds every normative statement of the vendored spec, word for word", () => {
    assert.deepEqual(sync(readFileSync(specPath, "utf8")), { missing: [], stale: [], moved: [] });
  });

  it("gives each requirement a unique ID", () => {
    assert.equal(ids.size, all.length);
  });

  it("numbers each statement under its section's prefix", () => {
    for (const r of all) {
      const prefix = r.id.replace(/-[^-]+$/, "");
      assert.equal(registry.sections[prefix], r.section, r.id);
    }
  });

  it("records each statement's strength as its keywords give it", () => {
    for (const r of all.filter((x) => !x.definition && (!x.id.startsWith("CDDL-") || x.id === "CDDL-1"))) {
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

  for (const mode of ["document", "fetch"] as const) {
    it(`files exactly the \`check: ${mode}\` requirements as ${mode} checks`, () => {
      const declared = all.filter((r) => r.check === mode).map((r) => r.id).sort();
      assert.deepEqual(Object.keys(CHECKS[mode]).sort(), declared);
    });
  }

  it("refers only to IDs that exist", () => {
    for (const r of all) {
      for (const ref of `${r.excluded ?? ""} ${r.note ?? ""}`.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
        assert.ok(ids.has(ref), `${r.id} refers to ${ref}, which does not exist`);
      }
    }
  });
});

describe("the facts read from the spec", () => {
  const facts = specFacts();

  it("include every CDDL rule the registry holds", () => {
    const rules = loadRegistry().requirements.filter((r) => /^CDDL-[A-Z]/.test(r.id)).map((r) => r.id.slice(5));
    assert.deepEqual(Object.keys(facts.cddl).sort(), rules.sort());
  });

  it("mark the catalog, entry, host and publisher open, and the trust objects closed", () => {
    const open = Object.entries(facts.cddl).filter(([, r]) => r.open).map(([n]) => n).sort();
    assert.deepEqual(open, ["AICatalog", "CatalogEntry", "HostInfo", "Publisher"]);
  });

  it("list each media type the checks act on among the spec's known types", () => {
    for (const type of Object.values(MEDIA_TYPES)) assert.ok(facts.knownTypes.has(type), type);
  });

  it("give a protected typ for each kind of signed object", () => {
    assert.match(facts.jwsTyp.trustManifest, /\+jws$/);
    assert.match(facts.jwsTyp.catalog, /\+jws$/);
    assert.notEqual(facts.jwsTyp.trustManifest, facts.jwsTyp.catalog);
  });

  it("refuse a CDDL type the suite does not know, rather than skip it", () => {
    assert.throws(() => parseCddl([{ name: "X", text: "X = {\n  a: bstr,\n}" }]), /bstr/);
  });
});

it("COVERAGE.md is current (npm run coverage)", () => {
  assert.equal(readFileSync(new URL("../COVERAGE.md", import.meta.url), "utf8"), coverageMarkdown());
});
