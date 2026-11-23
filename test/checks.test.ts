// Each checked requirement, broken one way at a time.
//
// `complete.json` uses every part of the spec and passes. Each case in cases.ts
// makes one change to a copy and expects its requirement to fail, warn or notice.
// A test at the end fails when a checked requirement has no case.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentChecks } from "../src/checks/document.ts";
import { nimblebrainChecks } from "../src/checks/nimblebrain.ts";
import { signatureChecks } from "../src/checks/signature.ts";
import { parseJson } from "../src/json.ts";
import { type Report, run } from "../src/run.ts";
import { CASES, check, COMPLETE, mutated, statusOf } from "./cases.ts";

describe("complete.json", () => {
  it("passes every document check, at Level 2", async () => {
    const report = await check(() => {}, ["nimblebrain"]);
    const bad = report.results.filter((r) => !["pass", "skipped"].includes(r.status));
    assert.deepEqual(bad, []);
    assert.equal(report.level, 2);
    assert.equal(report.failed, false);
  });
});

describe("each requirement, broken", () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.why}`, async () => {
      const report: Report = await run({ text: mutated(c), source: "test", profiles: c.profile ? [c.profile] : [] });
      assert.equal(statusOf(report, c.id), c.expect, JSON.stringify(report.results.find((r) => r.id === c.id)));
    });
  }
});

describe("levels", () => {
  it("is Level 1 without a host", async () => {
    assert.equal((await check((c) => delete c.host)).level, 1);
  });
  it("is not conformant when a MUST fails", async () => {
    assert.equal((await check((c) => (c.specVersion = "1.0"))).level, 0);
  });
  it("stays conformant when only a SHOULD warns", async () => {
    const report = await check((c) => (c.additionalSignatures = []));
    assert.equal(report.level, 2);
    assert.equal(report.failed, false);
  });
  it("keeps its level when only a profile fails, and the run fails", async () => {
    const report = await check((c) => (c.entries[0].publisher.identifier = "other.example"), ["nimblebrain"]);
    assert.equal(report.level, 2);
    assert.equal(report.failed, true);
  });
});

describe("boundaries that pass", () => {
  it("accepts February 29 of a leap year and the last day of each month", async () => {
    for (const updatedAt of ["2024-02-29T12:00:00Z", "2000-02-29T00:00:00Z", "2026-04-30T00:00:00Z", "2026-12-31T23:59:59Z"]) {
      assert.equal(statusOf(await check((c) => (c.entries[0].updatedAt = updatedAt)), "CDDL-CatalogEntry"), "pass", updatedAt);
    }
  });
  it("accepts safe integers and finite numbers in data, in any spelling", async () => {
    for (const n of ["9007199254740991", "-9007199254740991e0", "9007199254740.991e3", "1.5", "2.5e-300"]) {
      const text = mutated({ id: "ENTRY-18", expect: "pass", why: n, mutate: (c) => (c.entries[4].data.big = "__N__") }).replace('"__N__"', n);
      assert.equal(statusOf(await run({ text, source: "test" }), "ENTRY-18"), "pass", n);
    }
  });
});

describe("member names", () => {
  it("keeps __proto__ as an ordinary member, never a prototype", async () => {
    const text = '{"specVersion":"0.9","entries":[],"__proto__":{"host":{"displayName":"inherited"}}}';
    const report = await run({ text, source: "test" });
    assert.equal(report.level, 1);
    const { value } = parseJson(text) as { value: Record<string, unknown> };
    assert.ok(Object.hasOwn(value, "__proto__"));
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
  });
});

describe("the nimblebrain profile", () => {
  it("NB-3 accepts the publisher's domain as a did:web DID", async () => {
    const report = await check((c) => (c.entries[0].publisher.identifier = "did:web:acme.example"), ["nimblebrain"]);
    assert.equal(statusOf(report, "NB-3"), "pass");
  });
});

describe("documents that are not catalogs", () => {
  it("fails TOP-1 on invalid JSON and skips the rest", async () => {
    const report = await run({ text: "{", source: "test" });
    assert.equal(statusOf(report, "TOP-1"), "fail");
    assert.equal(statusOf(report, "SVPROD-1"), "skipped");
    assert.equal(report.level, 0);
  });
  it("fails TOP-1 on a JSON array", async () => {
    assert.equal(statusOf(await run({ text: "[]", source: "test" }), "TOP-1"), "fail");
  });
});

describe("baseline", () => {
  it("turns an expected failure into a pass for the run", async () => {
    const catalog = JSON.parse(COMPLETE);
    catalog.specVersion = "1.0";
    const report = await run({
      text: JSON.stringify(catalog),
      source: "test",
      baseline: { expected: [{ id: "SVPROD-1", reason: "moving next release" }] },
    });
    assert.equal(statusOf(report, "SVPROD-1"), "expected");
    assert.equal(report.failed, false);
    assert.equal(report.level, 0);
  });
  it("fails on a baseline entry that no longer fails", async () => {
    const report = await run({
      text: COMPLETE,
      source: "test",
      baseline: { expected: [{ id: "SVPROD-1", reason: "fixed already" }] },
    });
    assert.deepEqual(report.staleBaseline, ["SVPROD-1"]);
    assert.equal(report.failed, true);
  });
});

describe("findings", () => {
  it("carry the line of the offending value", async () => {
    const report = await check((c) => (c.specVersion = "1.0"));
    const finding = report.results.find((r) => r.id === "SVPROD-1")!.findings[0]!;
    assert.equal(finding.at, "/specVersion");
    assert.equal(finding.line, 2);
  });
});

it("every checked document requirement has a case here", () => {
  const covered = new Set(CASES.map((c) => c.id));
  const uncovered = Object.keys({ ...documentChecks, ...signatureChecks, ...nimblebrainChecks }).filter((id) => !covered.has(id));
  assert.deepEqual(uncovered, []);
});
