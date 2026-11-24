// Which spec version a catalog is checked against: the one it declares when this
// release checks it, the one asked for, or the newest when it names none it can.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LATEST_SPEC, loadRegistry, SPEC_VERSIONS } from "../src/registry.ts";
import { github, text } from "../src/report.ts";
import { run, UnsupportedSpecError } from "../src/run.ts";
import { COMPLETE } from "./cases.ts";

const withSpec = (specVersion: unknown) => JSON.stringify({ ...JSON.parse(COMPLETE), specVersion });

describe("the spec version", () => {
  it("is each requirements file in requirements/, and each names its own version", () => {
    assert.ok(SPEC_VERSIONS.length > 0);
    for (const v of SPEC_VERSIONS) assert.equal(loadRegistry(v).spec.version, v);
    assert.equal(LATEST_SPEC, SPEC_VERSIONS.at(-1));
  });

  it("is the one the catalog declares, when this release checks it", async () => {
    const report = await run({ text: withSpec(LATEST_SPEC), source: "t" });
    assert.deepEqual([report.spec.version, report.spec.chosen], [LATEST_SPEC, "declared"]);
    assert.equal(report.failed, false);
  });

  it("is the one asked for, whatever the catalog declares", async () => {
    const report = await run({ text: withSpec("0.9.0"), source: "t", spec: LATEST_SPEC });
    assert.deepEqual([report.spec.version, report.spec.chosen], [LATEST_SPEC, "requested"]);
    assert.equal(report.results.find((r) => r.id === "SVPROD-1")?.status, "fail");
    assert.match(text(report), /\(as asked\)/);
  });

  it("refuses to be asked for a version this release does not check", async () => {
    await assert.rejects(run({ text: COMPLETE, source: "t", spec: "7.0" }), UnsupportedSpecError);
  });

  it("answers, without checking, a catalog that declares a version this release does not check", async () => {
    const report = await run({ text: withSpec("7.0"), source: "t" });
    assert.deepEqual(report.unsupportedSpec, { declared: "7.0", supported: SPEC_VERSIONS });
    assert.deepEqual(report.results, []);
    assert.equal(report.failed, true);
    const out = text(report);
    assert.match(out, /✗ Declares AI Catalog 7\.0, which this release does not check/);
    assert.match(out, new RegExp(`pass --spec ${LATEST_SPEC.replace(".", "\\.")}\\.`));
    assert.match(github(report, "c.json"), /^::error file=c\.json,title=Unsupported AI Catalog version::/);
  });

  it("is the newest, and SVPROD-1 fails, when the catalog's specVersion is malformed or missing", async () => {
    for (const specVersion of ["0.9.0", 0.9, undefined]) {
      const report = await run({ text: withSpec(specVersion), source: "t" });
      assert.deepEqual([report.spec.version, report.spec.chosen], [LATEST_SPEC, "latest"], String(specVersion));
      assert.ok(report.failed, String(specVersion));
    }
  });
});
