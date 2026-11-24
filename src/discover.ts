// Finds a website's AI Catalog the way the spec's Link Relation Discovery says
// an agent should: the URL itself when it is a catalog, else the `ai-catalog`
// link relation in its HTTP `Link` header, else in its HTML `<link>` elements,
// else the well-known URI. What it finds must be JSON with a `specVersion`.

import { parse } from "parse5";
import { parseLinkHeader } from "./vendor/http-link-header.ts";
import type { Fetched } from "./checks/types.ts";

export type Via = "direct" | "link-header" | "html-link" | "well-known";

export interface Discovered {
  /** The URL the catalog was read from, after redirects. */
  url: string;
  response: Fetched;
  via: Via;
  /** The URL discovery started from. */
  from: string;
}

export class DiscoveryError extends Error {
  /** What was looked at, in order, and what each showed. */
  readonly tried: string[];
  constructor(message: string, tried: string[]) {
    super(message);
    this.tried = tried;
  }
}

export const WELL_KNOWN = "/.well-known/ai-catalog.json";

const HTML = new Set(["text/html", "application/xhtml+xml"]);

function isJsonType(type: string | undefined): boolean {
  return type === "application/json" || (type?.endsWith("+json") ?? false);
}

/** Why a response is not a catalog, or undefined when it is one. */
function notCatalog(f: Fetched): string | undefined {
  if (f.status < 200 || f.status > 299) return `answered ${f.status}`;
  if (!isJsonType(f.mediaType)) return `is ${f.mediaType ?? "of no media type"}, not JSON`;
  try {
    const value = JSON.parse(new TextDecoder().decode(f.bytes)) as unknown;
    const ok = typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).specVersion === "string";
    return ok ? undefined : "is JSON without a `specVersion`";
  } catch {
    return "is not valid JSON";
  }
}

const hasRel = (rel: string) => rel.toLowerCase().split(/\s+/).includes("ai-catalog");

/**
 * The target of the first `rel="ai-catalog"` link in a `Link` header [RFC 8288],
 * resolved against `base`. A header that does not parse advertises nothing.
 */
export function linkHeaderTarget(header: string, base: string): string | undefined {
  let refs;
  try {
    refs = parseLinkHeader(header);
  } catch {
    return undefined;
  }
  for (const ref of refs) {
    if (typeof ref.rel !== "string" || ref.rel.toLowerCase() !== "ai-catalog") continue;
    try {
      return new URL(ref.uri, base).href;
    } catch {
      // A target that does not parse leads nowhere; look for the next one.
    }
  }
  return undefined;
}

interface HtmlNode {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
}

/** The document's elements in tree order. Comments, text and inert `<template>` contents are not elements. */
function* elements(node: HtmlNode): Generator<HtmlNode> {
  if (node.attrs) yield node;
  for (const child of node.childNodes ?? []) yield* elements(child);
}

const attr = (el: HtmlNode, name: string) => el.attrs?.find((a) => a.name === name)?.value;

/**
 * The `href` of the first `<link rel="ai-catalog">` in an HTML document, resolved
 * as a browser would: against the document's `<base href>` when it has one. The
 * HTML parser (parse5) decodes character references and leaves out what a browser
 * would not treat as an element, such as a link inside a comment.
 */
export function htmlLinkTarget(html: string, pageUrl: string): string | undefined {
  const all = [...elements(parse(html) as unknown as HtmlNode)];
  const baseHref = all.find((el) => el.nodeName === "base" && attr(el, "href") !== undefined);
  let base = pageUrl;
  try {
    if (baseHref) base = new URL(attr(baseHref, "href")!, pageUrl).href;
  } catch {
    // An unparseable <base href> leaves the page's URL as the base, as in a browser.
  }
  for (const el of all) {
    if (el.nodeName !== "link") continue;
    const rel = attr(el, "rel");
    const href = attr(el, "href");
    if (rel === undefined || href === undefined || !hasRel(rel)) continue;
    try {
      return new URL(href, base).href;
    } catch {
      // A link whose href does not parse leads nowhere; look for the next one.
    }
  }
  return undefined;
}

export async function discover(start: string, fetch: (url: string) => Promise<Fetched>): Promise<Discovered> {
  const tried: string[] = [];
  const first = await fetch(start);
  const firstWhy = notCatalog(first);
  if (!firstWhy) return { url: first.url, response: first, via: "direct", from: start };
  tried.push(`${first.url} ${firstWhy}`);

  // An advertised link takes precedence: when the header names one, the HTML and
  // the well-known URI are not consulted, and a broken link is the answer.
  let target: string | undefined;
  let via: Via = "well-known";
  if (first.link) {
    target = linkHeaderTarget(first.link, first.url);
    if (target) via = "link-header";
  }
  if (!target && first.mediaType && HTML.has(first.mediaType)) {
    target = htmlLinkTarget(new TextDecoder().decode(first.bytes), first.url);
    if (target) via = "html-link";
  }
  if (!target) {
    tried.push(`${first.url} advertises no ai-catalog link`);
    target = new URL(WELL_KNOWN, first.url).href;
  }

  const found = await fetch(target);
  const why = notCatalog(found);
  if (!why) return { url: found.url, response: found, via, from: start };
  tried.push(`${found.url} ${why}`);
  throw new DiscoveryError(`found no AI Catalog from ${start}`, tried);
}

/** How a report names the way it found the catalog: "found via <this> on <the site>". */
export const VIA_TEXT: Record<Via, string> = {
  direct: "",
  "link-header": 'the Link header rel="ai-catalog"',
  "html-link": '<link rel="ai-catalog">',
  "well-known": "the well-known URI",
};
