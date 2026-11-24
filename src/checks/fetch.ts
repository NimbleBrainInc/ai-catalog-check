// Checks that fetch the catalog's own URL or the artifacts its entries name,
// keyed by requirement ID. They run only when asked to (`--fetch`), since a
// catalog checked before it deploys names artifacts that may not be live yet.

import { createHash } from "node:crypto";
import { type Json, parseJson, pointer } from "../json.ts";
import type { FetchCheck, FetchContext, Fetched, JsonObject, Outcome, Violation } from "./types.ts";
import { type EntryAt, entries, has, isObject, MEDIA_TYPES } from "./walk.ts";

const NODE_HASH: Record<string, string> = {
  sha256: "sha256",
  sha384: "sha384",
  sha512: "sha512",
  "sha3-256": "sha3-256",
  "sha3-384": "sha3-384",
  "sha3-512": "sha3-512",
};

/** Where an entry's artifact is to be fetched from, resolved against the catalog's URL. */
function artifactUrl(ctx: FetchContext, e: EntryAt): string | undefined {
  const url = e.value.url;
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url, ctx.catalogUrl).href;
  } catch {
    return undefined;
  }
}

async function fetchEntry(ctx: FetchContext, e: EntryAt): Promise<Fetched | Violation | undefined> {
  const url = artifactUrl(ctx, e);
  if (!url) return undefined;
  try {
    const got = await ctx.fetch(url);
    if (got.status < 200 || got.status > 299) {
      return { at: pointer(e.at, "url"), message: `${url} answered ${got.status}` };
    }
    return got;
  } catch (error) {
    return { at: pointer(e.at, "url"), message: `${url} could not be fetched: ${(error as Error).message}` };
  }
}

const isViolation = (v: Fetched | Violation | undefined): v is Violation => !!v && "message" in v;

type Card = { artifact: JsonObject } | { violation: Violation } | undefined;

/** The artifact a card entry describes: its inline `data`, or the JSON fetched from its `url`. */
async function card(ctx: FetchContext, e: EntryAt): Promise<Card> {
  if (has(e.value, "data")) return isObject(e.value.data) ? { artifact: e.value.data } : undefined;
  const got = await fetchEntry(ctx, e);
  if (!got) return undefined;
  if (isViolation(got)) return { violation: got };
  try {
    const parsed = parseJson(new TextDecoder().decode(got.bytes)).value;
    return isObject(parsed) ? { artifact: parsed } : undefined;
  } catch {
    return { violation: { at: pointer(e.at, "url"), message: `${got.url} did not return JSON` } };
  }
}

/** For each card entry: the artifact's own value of `field`, beside the entry. */
async function overCards(
  ctx: FetchContext,
  select: (e: EntryAt) => boolean,
  each: (e: EntryAt, artifact: JsonObject, field: { name?: Json; description?: Json; version?: Json }) => Violation[],
): Promise<Outcome> {
  const cards = entries(ctx.catalog).filter(
    (e) => (e.value.type === MEDIA_TYPES.mcpServerCard || e.value.type === MEDIA_TYPES.a2aAgentCard) && select(e),
  );
  if (cards.length === 0) return "n/a";
  const out: Violation[] = [];
  for (const e of cards) {
    const got = await card(ctx, e);
    if (!got) continue;
    if ("violation" in got) {
      out.push(got.violation);
      continue;
    }
    const { artifact } = got;
    // An MCP Server Card names itself in `title`, an A2A Agent Card in `name`.
    const name = e.value.type === MEDIA_TYPES.mcpServerCard ? artifact.title : artifact.name;
    out.push(...each(e, artifact, { name, description: artifact.description, version: artifact.version }));
  }
  return out;
}

const present = (v: Json | undefined): v is string => typeof v === "string" && v.length > 0;

function sameIdentifierCount(ctx: FetchContext, e: EntryAt): number {
  return entries(ctx.catalog).filter((o) => o.value.identifier === e.value.identifier).length;
}

export const fetchChecks: Record<string, FetchCheck> = {
  "LOC-1": async (ctx) => {
    if (!ctx.catalogResponse) return "n/a";
    const type = ctx.catalogResponse.mediaType;
    return type === MEDIA_TYPES.aiCatalog
      ? []
      : [{ at: "", message: `${ctx.catalogResponse.url} is served as ${type ?? "(no media type)"}, not ${MEDIA_TYPES.aiCatalog}` }];
  },

  "ENTRY-8": async (ctx) => {
    const withUrl = entries(ctx.catalog).filter((e) => artifactUrl(ctx, e) && typeof e.value.type === "string");
    if (withUrl.length === 0) return "n/a";
    const out: Violation[] = [];
    for (const e of withUrl) {
      const got = await fetchEntry(ctx, e);
      if (!got) continue;
      if (isViolation(got)) {
        out.push(got);
        continue;
      }
      const declared = (e.value.type as string).toLowerCase();
      if (got.mediaType !== declared) {
        out.push({ at: pointer(e.at, "url"), message: `${got.url} is served as ${got.mediaType ?? "(no media type)"}, not ${declared}` });
      }
    }
    return out;
  },

  "INTEG-1": async (ctx) => {
    const withDigest = entries(ctx.catalog).filter(
      (e) => typeof e.value.digest === "string" && (has(e.value, "url") || has(e.value, "data")),
    );
    if (withDigest.length === 0) return "n/a";
    const out: Violation[] = [];
    for (const e of withDigest) {
      const [alg, hex] = (e.value.digest as string).split(":", 2);
      const hash = alg && NODE_HASH[alg];
      if (!hash || !hex) continue; // DIGEST-1 reports a malformed digest
      if (has(e.value, "data")) continue; // hashing inline data needs JCS, not yet implemented
      const got = await fetchEntry(ctx, e);
      if (!got) continue;
      if (isViolation(got)) {
        out.push(got);
        continue;
      }
      const actual = createHash(hash).update(got.bytes).digest("hex");
      if (actual !== hex) {
        out.push({ at: pointer(e.at, "digest"), message: `the bytes at ${got.url} hash to ${alg}:${actual}` });
      }
    }
    return out;
  },

  "ENTRY-10": (ctx) =>
    overCards(ctx, (e) => has(e.value, "displayName"), (e, _a, f) =>
      present(f.name)
        ? [{ at: pointer(e.at, "displayName"), message: `the artifact names itself "${f.name}"; omit \`displayName\` unless overriding it on purpose` }]
        : [],
    ),

  "ENTRY-12": (ctx) =>
    overCards(ctx, (e) => has(e.value, "description"), (e, _a, f) =>
      present(f.description)
        ? [{ at: pointer(e.at, "description"), message: "the artifact carries its own description; omit `description` unless overriding it on purpose" }]
        : [],
    ),

  "ENTRY-15": (ctx) =>
    overCards(
      ctx,
      (e) => has(e.value, "version") && !has(e.value, "trustManifests") && sameIdentifierCount(ctx, e) === 1,
      (e, _a, f) =>
        present(f.version)
          ? [{ at: pointer(e.at, "version"), message: `the artifact reports version "${f.version}"; a single entry should omit \`version\`` }]
          : [],
    ),

  "ENTRY-17": (ctx) =>
    overCards(ctx, (e) => typeof e.value.version === "string", (e, _a, f) =>
      present(f.version) && f.version !== e.value.version
        ? [{ at: pointer(e.at, "version"), message: `the artifact reports version "${f.version}", not "${e.value.version}"` }]
        : [],
    ),
};

/** A fetcher that asks for each URL once. */
export function cachingFetcher(timeoutMs = 15000): (url: string) => Promise<Fetched> {
  const cache = new Map<string, Promise<Fetched>>();
  return (url) => {
    let got = cache.get(url);
    if (!got) {
      got = (async () => {
        const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        const type = response.headers.get("content-type");
        const link = response.headers.get("link");
        return {
          url: response.url || url,
          status: response.status,
          mediaType: type ? type.split(";")[0]!.trim().toLowerCase() : undefined,
          ...(link ? { link } : {}),
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      })();
      cache.set(url, got);
    }
    return got;
  };
}
