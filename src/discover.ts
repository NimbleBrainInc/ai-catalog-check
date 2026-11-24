// Finds a website's AI Catalog the way the spec's Link Relation Discovery says
// an agent should: the URL itself when it is a catalog, else the `ai-catalog`
// link relation in its HTTP `Link` header, else in its HTML `<link>` elements,
// else the well-known URI. What it finds must be JSON with a `specVersion`.

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

/** The target of the first `rel="ai-catalog"` link in a `Link` header [RFC 8288]. */
export function linkHeaderTarget(header: string, base: string): string | undefined {
  for (const m of header.matchAll(/<([^>]*)>((?:\s*;\s*[^;,]+)*)/g)) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(m[2] ?? "");
    if (rel && hasRel(rel[1] ?? rel[2] ?? "")) return new URL(m[1]!, base).href;
  }
  return undefined;
}

/** The `href` of the first `<link rel="ai-catalog">` in an HTML document. */
export function htmlLinkTarget(html: string, base: string): string | undefined {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[0].matchAll(/([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    }
    if (attrs.rel && attrs.href && hasRel(attrs.rel)) return new URL(attrs.href, base).href;
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

export const VIA_TEXT: Record<Via, string> = {
  direct: "",
  "link-header": "by its Link header",
  "html-link": 'by its <link rel="ai-catalog">',
  "well-known": "at the well-known URI",
};
