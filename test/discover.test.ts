// Discovery, against a fake web: each way the spec lets a site point at its
// catalog, the order they are tried in, and what a failure says.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Fetched } from "../src/checks/types.ts";
import { DiscoveryError, discover, htmlLinkTarget, linkHeaderTarget } from "../src/discover.ts";
import { text } from "../src/report.ts";
import { run } from "../src/run.ts";

const CATALOG = JSON.stringify({ specVersion: "0.9", entries: [] });

type Page = { type?: string; body: string; status?: number; link?: string };

function web(site: Record<string, Page>): (url: string) => Promise<Fetched> {
  return async (url) => {
    const page = site[url];
    if (!page) return { url, status: 404, mediaType: "text/plain", bytes: new Uint8Array() };
    return {
      url,
      status: page.status ?? 200,
      mediaType: page.type,
      ...(page.link ? { link: page.link } : {}),
      bytes: new TextEncoder().encode(page.body),
    };
  };
}

const json = (body = CATALOG): Page => ({ type: "application/ai-catalog+json", body });
const html = (head: string, link?: string): Page => ({ type: "text/html", body: `<html><head>${head}</head></html>`, ...(link ? { link } : {}) });

describe("discovery", () => {
  it("takes a URL that is itself a catalog", async () => {
    const found = await discover("https://a.example/c.json", web({ "https://a.example/c.json": json() }));
    assert.equal(found.via, "direct");
  });

  it("accepts a catalog served as plain application/json", async () => {
    const found = await discover("https://a.example/c.json", web({ "https://a.example/c.json": { type: "application/json", body: CATALOG } }));
    assert.equal(found.via, "direct");
  });

  it("follows a Link header", async () => {
    const found = await discover(
      "https://a.example/",
      web({
        "https://a.example/": html("", '<https://a.example/style.css>; rel="stylesheet", </ai/catalog.json>; rel="ai-catalog"'),
        "https://a.example/ai/catalog.json": json(),
      }),
    );
    assert.deepEqual([found.via, found.url], ["link-header", "https://a.example/ai/catalog.json"]);
  });

  it("follows an HTML <link>, relative to the page", async () => {
    const found = await discover(
      "https://a.example/docs/",
      web({
        "https://a.example/docs/": html(`<link rel='alternate ai-catalog' type="application/ai-catalog+json" href="../cat.json">`),
        "https://a.example/cat.json": json(),
      }),
    );
    assert.deepEqual([found.via, found.url], ["html-link", "https://a.example/cat.json"]);
  });

  it("falls back to the well-known URI at the origin", async () => {
    const found = await discover(
      "https://a.example/docs/page",
      web({ "https://a.example/docs/page": html(""), "https://a.example/.well-known/ai-catalog.json": json() }),
    );
    assert.deepEqual([found.via, found.url], ["well-known", "https://a.example/.well-known/ai-catalog.json"]);
  });

  it("prefers the Link header to the HTML, and does not fall back when the advertised link is broken", async () => {
    await assert.rejects(
      discover(
        "https://a.example/",
        web({
          "https://a.example/": html(`<link rel="ai-catalog" href="/good.json">`, '</gone.json>; rel="ai-catalog"'),
          "https://a.example/good.json": json(),
          "https://a.example/.well-known/ai-catalog.json": json(),
        }),
      ),
      (e: DiscoveryError) => e.tried.some((t) => t.includes("/gone.json answered 404")),
    );
  });

  it("says what it tried when it finds nothing", async () => {
    await assert.rejects(discover("https://a.example/", web({ "https://a.example/": html("") })), (e: DiscoveryError) => {
      assert.deepEqual(e.tried, [
        "https://a.example/ is text/html, not JSON",
        "https://a.example/ advertises no ai-catalog link",
        "https://a.example/.well-known/ai-catalog.json answered 404",
      ]);
      return true;
    });
  });

  it("rejects JSON that is not a catalog", async () => {
    await assert.rejects(
      discover("https://a.example/", web({ "https://a.example/": html(""), "https://a.example/.well-known/ai-catalog.json": json("{}") })),
      (e: DiscoveryError) => e.tried.at(-1)!.endsWith("is JSON without a `specVersion`"),
    );
  });
});

describe("link parsing", () => {
  it("reads rel lists and unquoted rels in a Link header", () => {
    assert.equal(linkHeaderTarget("</a>; rel=ai-catalog", "https://x.example/"), "https://x.example/a");
    assert.equal(linkHeaderTarget('</a>; rel="next AI-Catalog"', "https://x.example/"), "https://x.example/a");
    assert.equal(linkHeaderTarget('</a>; rel="ai-catalogue"', "https://x.example/"), undefined);
  });

  it("decodes character references in href (r5c1)", async () => {
    const found = await discover(
      "https://a.example/",
      web({
        "https://a.example/": html(`<link rel="ai-catalog" href="/catalog.json?a=1&amp;b=2">`),
        "https://a.example/catalog.json?a=1&b=2": json(),
      }),
    );
    assert.equal(found.url, "https://a.example/catalog.json?a=1&b=2");
  });

  it("ignores a commented-out link and follows the live one (r5c1)", async () => {
    const found = await discover(
      "https://a.example/",
      web({
        "https://a.example/": html(`<!-- <link rel="ai-catalog" href="/retired.json"> --><link rel="ai-catalog" href="/catalog.json">`),
        "https://a.example/catalog.json": json(),
      }),
    );
    assert.equal(found.url, "https://a.example/catalog.json");
  });

  it("ignores links inside <template>, which a browser treats as inert", () => {
    const page = `<template><link rel="ai-catalog" href="/t.json"></template><link rel="ai-catalog" href="/c.json">`;
    assert.equal(htmlLinkTarget(page, "https://x.example/"), "https://x.example/c.json");
  });

  it("resolves against <base href>, and finds a link in the body", () => {
    const page = `<head><base href="https://cdn.example/site/"></head><body><link rel="ai-catalog" href="ai.json"></body>`;
    assert.equal(htmlLinkTarget(page, "https://x.example/page"), "https://cdn.example/site/ai.json");
  });

  it("skips a link whose href is not a URL", () => {
    assert.equal(htmlLinkTarget(`<link rel="ai-catalog" href="http://[bad"><link rel="ai-catalog" href="/c.json">`, "https://x.example/"), "https://x.example/c.json");
    assert.equal(linkHeaderTarget('<http://[bad>; rel="ai-catalog", </c.json>; rel="ai-catalog"', "https://x.example/"), "https://x.example/c.json");
  });

  it("reads <link> attributes in any order and quoting", () => {
    assert.equal(htmlLinkTarget(`<LINK HREF=/c.json REL=ai-catalog>`, "https://x.example/p"), "https://x.example/c.json");
    assert.equal(htmlLinkTarget(`<link rel="stylesheet" href="/s.css">`, "https://x.example/"), undefined);
  });
});

it("the report says how the catalog was found", async () => {
  const report = await run({
    text: CATALOG,
    source: "https://a.example/.well-known/ai-catalog.json",
    discovery: { from: "https://a.example/", via: "html-link" },
  });
  assert.match(text(report), /\nfound via <link rel="ai-catalog"> on https:\/\/a\.example\/\n/);
});
