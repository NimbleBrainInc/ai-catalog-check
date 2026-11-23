// The text report: problems only by default, every result with --verbose.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { text } from "../src/report.ts";
import { check } from "./cases.ts";

describe("the text report", () => {
  it("lists only problems by default", async () => {
    const out = text(await check((c) => (c.specVersion = "1.0")));
    assert.match(out, /✗ SVPROD-1 MUST/);
    assert.doesNotMatch(out, /TOP-1/);
  });

  it("lists every result with --verbose, with the sentence it checks and why it was skipped", async () => {
    const report = await check((c) => (c.specVersion = "1.0"));
    const out = text(report, { verbose: true });
    for (const r of report.results) assert.ok(out.includes(` ${r.id} ${r.strength}`), r.id);
    assert.match(out, /✓ TOP-1 MUST\n {4}An AI Catalog document is a JSON object that MUST contain the following members:/);
    assert.match(out, /- LOC-1 SHOULD \(skipped: Needs --fetch\.\)/);
  });

  it("caps findings per requirement by default and lists them all with --verbose", async () => {
    const report = await check((c) => {
      for (const e of c.entries) e.region = "us";
      c.region = "us";
      c.host.region = "us";
    });
    const findings = report.results.find((r) => r.id === "STABLE-1")!.findings.length;
    assert.ok(findings > 5);
    assert.match(text(report), new RegExp(`and ${findings - 5} more \\(--verbose lists every one\\)`));
    assert.doesNotMatch(text(report, { verbose: true }), /more \(--verbose/);
  });
});
