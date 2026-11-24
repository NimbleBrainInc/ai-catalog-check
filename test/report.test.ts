// The text report: a verdict, then problems only by default; every result,
// grouped, with --verbose; one line when the input is not a catalog.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { text } from "../src/report.ts";
import { run } from "../src/run.ts";
import { check } from "./cases.ts";

describe("the text report", () => {
  it("leads with the verdict, then lists only problems by name", async () => {
    const out = text(await check((c) => (c.specVersion = "1.0")));
    assert.match(out, /\n✗ Not conformant: 1 MUST fails\n/);
    assert.match(out, /✗ SVPROD-1 {2}specVersion is the version implemented {2}MUST\n {6}line 2 {2}\/specVersion {2}is "1\.0"/);
    assert.doesNotMatch(out, /TOP-1/);
    assert.match(out, /\n\d+ passed · 1 failed · \d+ need --fetch$/);
  });

  it("says when a catalog conforms, with its warnings", async () => {
    assert.match(text(await check(() => {})), /\n✓ Conforms at Level 2 \(Discoverable\)\n/);
    assert.match(text(await check((c) => (c.additionalSignatures = []))), /✓ Conforms at Level 2 \(Discoverable\) · 1 warning\n/);
  });

  it("lists every result by group with --verbose, and what needs --fetch on one line", async () => {
    const report = await check((c) => (c.specVersion = "1.0"));
    const out = text(report, { verbose: true });
    for (const r of report.results.filter((x) => x.status !== "skipped")) assert.ok(out.includes(` ${r.id} `), r.id);
    assert.match(out, /\nCatalog\n {2}✓ TOP-1 +Catalog has specVersion and entries +MUST\n/);
    assert.match(out, /\nNeeds --fetch\n {2}· ENTRY-8, /);
  });

  it("collapses a group with nothing to check", async () => {
    const report = await check((c) => {
      for (const e of c.entries) delete e.trustManifests;
    });
    assert.match(text(report, { verbose: true }), /\nSignatures\n {2}· \d+ requirements, none applicable to this catalog\n/);
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

  it("says in one line that a document is not a catalog", async () => {
    const out = text(await run({ text: "<html>", source: "page.html" }));
    assert.match(out, /\n✗ Not an AI Catalog: it is not JSON: unexpected character \(line 1\)$/);
    assert.doesNotMatch(out, /skipped|need --fetch/);
  });

  it("colors only when asked", async () => {
    const report = await check((c) => (c.specVersion = "1.0"));
    assert.doesNotMatch(text(report), /\x1b\[/);
    assert.match(text(report, { color: true }), /\x1b\[31m✗\x1b\[0m/);
  });
});
