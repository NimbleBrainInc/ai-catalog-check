// The fetch checks, against a fake web.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { fetchChecks } from "../src/checks/fetch.ts";
import type { Fetched } from "../src/checks/types.ts";
import { text } from "../src/report.ts";
import { type Report, run } from "../src/run.ts";

const CATALOG_URL = "https://acme.example/.well-known/ai-catalog.json";
const PLUGIN = new TextEncoder().encode("plugin bytes");
const PLUGIN_DIGEST = `sha256:${createHash("sha256").update(PLUGIN).digest("hex")}`;

type Site = Record<string, { type?: string; body: Uint8Array | object; status?: number }>;

function web(site: Site): (url: string) => Promise<Fetched> {
  return async (url) => {
    const page = site[url];
    if (!page) return { url, status: 404, mediaType: "text/plain", bytes: new Uint8Array() };
    const bytes = page.body instanceof Uint8Array ? page.body : new TextEncoder().encode(JSON.stringify(page.body));
    return { url, status: page.status ?? 200, mediaType: page.type, bytes };
  };
}

function catalog(entries: object[]) {
  return JSON.stringify({ specVersion: "0.9", entries }, null, 2);
}

const SITE: Site = {
  "https://acme.example/plugins/tools.zip": { type: "application/agent-plugins+zip", body: PLUGIN },
  "https://acme.example/mcp/card.json": {
    type: "application/mcp-server-card+json",
    body: { name: "acme/weather", title: "Weather", description: "Forecasts.", version: "1.2.0" },
  },
  "https://acme.example/agents/finance.json": {
    type: "application/a2a-agent-card+json",
    body: { name: "Finance", description: "Books.", version: "2.0.0" },
  },
};

async function fetched(entries: object[], site: Site = SITE, catalogType = "application/ai-catalog+json"): Promise<Report> {
  const text = catalog(entries);
  return run({
    text,
    source: CATALOG_URL,
    fetch: true,
    catalogUrl: CATALOG_URL,
    catalogResponse: { url: CATALOG_URL, status: 200, mediaType: catalogType, bytes: new TextEncoder().encode(text) },
    fetcher: web(site),
  });
}

const status = (r: Report, id: string) => r.results.find((x) => x.id === id)?.status;

const plugin = { identifier: "urn:air:acme.example:tools:plugin", type: "application/agent-plugins+zip", url: "/plugins/tools.zip", digest: PLUGIN_DIGEST };
const mcp = { identifier: "urn:air:acme.example:weather:mcp", type: "application/mcp-server-card+json", url: "https://acme.example/mcp/card.json" };
const a2a = { identifier: "urn:air:acme.example:finance:a2a", type: "application/a2a-agent-card+json", url: "https://acme.example/agents/finance.json" };

describe("a catalog whose artifacts match it", () => {
  it("passes every fetch check", async () => {
    const report = await fetched([plugin, mcp, a2a]);
    for (const id of Object.keys(fetchChecks)) {
      assert.ok(["pass", "n/a"].includes(status(report, id)!), `${id}: ${status(report, id)}`);
    }
  });
  it("resolves a relative url against the catalog's", async () => {
    assert.equal(status(await fetched([plugin]), "INTEG-1"), "pass");
  });
});

describe("each fetch requirement, broken", () => {
  it("LOC-1: catalog served as application/json", async () => {
    assert.equal(status(await fetched([plugin], SITE, "application/json"), "LOC-1"), "warn");
  });
  it("LOC-1: not applicable to a file", async () => {
    const report = await run({ text: catalog([plugin]), source: "file.json", fetch: true, fetcher: web(SITE) });
    assert.equal(status(report, "LOC-1"), "n/a");
  });
  it("ENTRY-8: artifact served as application/zip", async () => {
    const site = { ...SITE, "https://acme.example/plugins/tools.zip": { type: "application/zip", body: PLUGIN } };
    assert.equal(status(await fetched([plugin], site), "ENTRY-8"), "warn");
  });
  it("ENTRY-8: artifact missing", async () => {
    const report = await fetched([{ ...plugin, url: "/plugins/gone.zip" }]);
    assert.equal(status(report, "ENTRY-8"), "warn");
    assert.match(report.results.find((r) => r.id === "ENTRY-8")!.findings[0]!.message, /answered 404/);
  });
  it("INTEG-1: digest of other bytes", async () => {
    assert.equal(status(await fetched([{ ...plugin, digest: `sha256:${"0".repeat(64)}` }]), "INTEG-1"), "fail");
  });
  it("ENTRY-10: displayName restating an MCP Server Card's title", async () => {
    assert.equal(status(await fetched([{ ...mcp, displayName: "Weather" }]), "ENTRY-10"), "warn");
  });
  it("ENTRY-10: displayName restating an A2A Agent Card's name", async () => {
    assert.equal(status(await fetched([{ ...a2a, displayName: "Finance" }]), "ENTRY-10"), "warn");
  });
  it("ENTRY-10: displayName on an inline card", async () => {
    const inline = { identifier: mcp.identifier, type: mcp.type, displayName: "W", data: { title: "Weather" } };
    assert.equal(status(await fetched([inline]), "ENTRY-10"), "warn");
  });
  it("ENTRY-12: description restating the card's", async () => {
    assert.equal(status(await fetched([{ ...mcp, description: "Forecasts." }]), "ENTRY-12"), "warn");
  });
  it("ENTRY-15: version on a single entry whose card has one", async () => {
    assert.equal(status(await fetched([{ ...mcp, version: "1.2.0" }]), "ENTRY-15"), "warn");
  });
  it("ENTRY-15: not reported when the entry is signed", async () => {
    const signedEntry = { ...mcp, version: "1.2.0", trustManifests: [{ contributor: "did:web:acme.example", extensions: { "com.acme.x": 1 } }] };
    assert.equal(status(await fetched([signedEntry]), "ENTRY-15"), "n/a");
  });
  it("ENTRY-17: version contradicting the card's", async () => {
    const report = await fetched([{ ...a2a, version: "2.1.0" }, { ...a2a, version: "2.0.0", url: "https://acme.example/agents/finance.json" }]);
    assert.equal(status(report, "ENTRY-17"), "warn");
  });
});

it("skips the fetch checks without --fetch", async () => {
  const report = await run({ text: catalog([plugin]), source: "file.json" });
  for (const id of Object.keys(fetchChecks)) assert.equal(status(report, id), "skipped");
});

describe("the level", () => {
  it("comes from the document alone: a live failure fails the run and leaves the level", async () => {
    const broken = [{ ...plugin, digest: `sha256:${"0".repeat(64)}` }];
    const live = await fetched(broken);
    const offline = await run({ text: catalog(broken), source: "file.json" });
    assert.equal(status(live, "INTEG-1"), "fail");
    assert.equal(live.level, offline.level);
    assert.equal(live.level, 1);
    assert.equal(live.failed, true);
    assert.equal(offline.failed, false);
  });

  it("is reported beside what the live copy shows", async () => {
    const report = await fetched([{ ...plugin, digest: `sha256:${"0".repeat(64)}` }]);
    assert.match(text(report), /Level 1 \(Minimal\), from the document\..*\nThe live copy and its artifacts: 1 failed, 0 warnings \(not counted in the level\)\./);
  });
});
