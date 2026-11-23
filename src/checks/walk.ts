// Finds the parts of a catalog that checks look at, each with its JSON Pointer.

import { type Json, pointer } from "../json.ts";
import type { JsonObject } from "./types.ts";

export function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function has(o: JsonObject, key: string): boolean {
  return Object.hasOwn(o, key);
}

export interface At<T> {
  value: T;
  at: string;
}

export interface EntryAt extends At<JsonObject> {
  index: number;
}

export interface ManifestAt extends At<JsonObject> {
  entry: EntryAt;
}

export function entries(catalog: JsonObject): EntryAt[] {
  const list = catalog.entries;
  if (!Array.isArray(list)) return [];
  const out: EntryAt[] = [];
  list.forEach((value, index) => {
    if (isObject(value)) out.push({ value, at: pointer("/entries", index), index });
  });
  return out;
}

export function manifests(catalog: JsonObject): ManifestAt[] {
  const out: ManifestAt[] = [];
  for (const entry of entries(catalog)) {
    const list = entry.value.trustManifests;
    if (!Array.isArray(list)) continue;
    list.forEach((value, i) => {
      if (isObject(value)) out.push({ value, at: pointer(pointer(entry.at, "trustManifests"), i), entry });
    });
  }
  return out;
}

/** The catalog's `signature` and each Trust Manifest's. */
export function signatures(catalog: JsonObject): At<JsonObject>[] {
  const out: At<JsonObject>[] = [];
  if (isObject(catalog.signature)) out.push({ value: catalog.signature, at: "/signature" });
  for (const m of manifests(catalog)) {
    if (isObject(m.value.signature)) out.push({ value: m.value.signature, at: pointer(m.at, "signature") });
  }
  return out;
}

/** Every `extensions` map: the catalog's, each entry's, and each Trust Manifest's. */
export function extensionMaps(catalog: JsonObject): At<JsonObject>[] {
  const out: At<JsonObject>[] = [];
  if (isObject(catalog.extensions)) out.push({ value: catalog.extensions, at: "/extensions" });
  for (const e of entries(catalog)) {
    if (isObject(e.value.extensions)) out.push({ value: e.value.extensions, at: pointer(e.at, "extensions") });
  }
  for (const m of manifests(catalog)) {
    if (isObject(m.value.extensions)) out.push({ value: m.value.extensions, at: pointer(m.at, "extensions") });
  }
  return out;
}

/** Each object in an array member of `parent`. */
export function objectsIn(parent: At<JsonObject>, key: string): At<JsonObject>[] {
  const list = parent.value[key];
  if (!Array.isArray(list)) return [];
  const out: At<JsonObject>[] = [];
  list.forEach((value, i) => {
    if (isObject(value)) out.push({ value, at: pointer(pointer(parent.at, key), i) });
  });
  return out;
}

export function member(parent: At<JsonObject>, key: string): At<JsonObject> | undefined {
  const value = parent.value[key];
  return isObject(value) ? { value, at: pointer(parent.at, key) } : undefined;
}

/** `urn:air:{publisher}:{name}[:{kind}]`, split; undefined when not of that form. */
export function urnAir(identifier: string): { publisher: string; name: string; kind?: string } | undefined {
  const m = /^urn:air:([^:]+):([^:]+)(?::([^:]+))?$/.exec(identifier);
  if (!m) return undefined;
  return { publisher: m[1]!, name: m[2]!, ...(m[3] ? { kind: m[3] } : {}) };
}

export const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

// RFC 3339 date-time.
export const RFC3339 =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const MEDIA_TYPES = {
  aiCatalog: "application/ai-catalog+json",
  agentCard: "application/agent-card+json",
  a2aAgentCard: "application/a2a-agent-card+json",
  mcpServerCard: "application/mcp-server-card+json",
  agentSkillsJson: "application/agent-skills+json",
  agentSkillsMd: "application/agent-skills+md",
  agentSkillsZip: "application/agent-skills+zip",
  agentSkillsGzip: "application/agent-skills+gzip",
  agentPluginsZip: "application/agent-plugins+zip",
  agentPluginsGzip: "application/agent-plugins+gzip",
} as const;

export const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.values(MEDIA_TYPES));
