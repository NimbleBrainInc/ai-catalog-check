// Facts the checks need, read from the spec rather than restated in code: the
// members and types each CDDL rule defines (from the registry's CDDL entries),
// the recognized media types (the list in Catalog Entry), and the protected
// `typ` each signed object needs (the table in Signed Payload and JWS
// Construction). A new spec version changes them by changing the spec.

import { readFileSync } from "node:fs";
import { loadRegistry, specPath } from "./registry.ts";

/** What a CDDL member's type requires of a JSON value. `any` requires nothing. */
export type Kind = "text" | "map" | "text[]" | "map[]" | "tdate" | "uint" | "any";

export interface CddlRule {
  /** Each member the rule defines, by name. */
  members: Record<string, Kind>;
  /** Whether the rule allows members it does not define (`* text => any`). */
  open: boolean;
}

export interface SpecFacts {
  cddl: Record<string, CddlRule>;
  knownTypes: ReadonlySet<string>;
  /** The protected `typ` a signature needs, by the kind of object that holds it. */
  jwsTyp: { trustManifest: string; catalog: string };
}

const SCALARS: Record<string, Kind> = { text: "text", tdate: "tdate", uint: "uint", any: "any" };

function kindOf(type: string, rules: ReadonlySet<string>, where: string): Kind {
  const t = type.trim();
  if (SCALARS[t]) return SCALARS[t];
  if (/^\{\s*\*\s*text\s*=>\s*any\s*\}$/.test(t)) return "map";
  if (rules.has(t)) return "map";
  const array = /^\[\s*\*\s*(\w+)\s*\]$/.exec(t);
  if (array) {
    const of = kindOf(array[1]!, rules, where);
    if (of === "text") return "text[]";
    if (of === "map") return "map[]";
  }
  throw new Error(`${where}: the CDDL type "${t}" is not one this suite reads; teach kindOf it`);
}

/** Parses the CDDL rules the spec defines, each a map of members. */
export function parseCddl(rules: { name: string; text: string }[]): Record<string, CddlRule> {
  const names = new Set(rules.map((r) => r.name));
  const out: Record<string, CddlRule> = {};
  for (const { name, text } of rules) {
    const body = /=\s*\{([\s\S]*)\}\s*$/.exec(text)?.[1];
    if (body === undefined) throw new Error(`CDDL ${name}: not a map rule`);
    const rule: CddlRule = { members: {}, open: false };
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line) continue;
      if (/^\*\s*text\s*=>\s*any$/.test(line)) {
        rule.open = true;
        continue;
      }
      // A choice of members, `(url: text // data: any)`: each is a member.
      const choice = /^\((.*)\)$/.exec(line);
      const parts = choice ? choice[1]!.split("//") : [line];
      for (const part of parts) {
        const m = /^\??\s*(\w+)\s*:\s*(.+)$/.exec(part.trim());
        if (!m) throw new Error(`CDDL ${name}: cannot read "${part.trim()}"`);
        rule.members[m[1]!] = kindOf(m[2]!, names, `CDDL ${name}.${m[1]}`);
      }
    }
    out[name] = rule;
  }
  return out;
}

/** The Markdown under a heading, up to the next heading of any level. */
function section(markdown: string, heading: string): string {
  const start = markdown.search(new RegExp(`^#+ ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
  if (start < 0) throw new Error(`the spec has no section "${heading}"`);
  const rest = markdown.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^#+ /m);
  return end < 0 ? rest : rest.slice(0, end);
}

export function readKnownTypes(markdown: string): Set<string> {
  const list = [...section(markdown, "Catalog Entry").matchAll(/^\s*- `([a-z0-9.+-]+\/[a-z0-9.+-]+)` —/gm)].map((m) => m[1]!);
  if (list.length === 0) throw new Error("found no known types in Catalog Entry");
  return new Set(list);
}

export function readJwsTyp(markdown: string): SpecFacts["jwsTyp"] {
  const rows = new Map(
    [...section(markdown, "Signed Payload and JWS Construction").matchAll(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$/gm)].map((m) => [m[1]!, m[2]!]),
  );
  const trustManifest = rows.get("Trust Manifest");
  const catalog = rows.get("Catalog root");
  if (!trustManifest || !catalog) throw new Error("found no protected `typ` table in Signed Payload and JWS Construction");
  return { trustManifest, catalog };
}

const cached = new Map<string, SpecFacts>();

/** What the checks need from one version of the spec. */
export function specFacts(version: string): SpecFacts {
  let facts = cached.get(version);
  if (!facts) {
    const markdown = readFileSync(specPath(version), "utf8");
    const rules = loadRegistry(version)
      .requirements.filter((r) => r.section === "cddl-schema" && r.id.startsWith("CDDL-") && /=\s*\{/.test(r.text))
      .map((r) => ({ name: r.id.slice("CDDL-".length), text: r.text }));
    facts = { cddl: parseCddl(rules), knownTypes: readKnownTypes(markdown), jwsTyp: readJwsTyp(markdown) };
    cached.set(version, facts);
  }
  return facts;
}
