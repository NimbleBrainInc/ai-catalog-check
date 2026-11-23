// Compares a spec's normative statements with a registry, both ways.
//
//   node src/sync.ts [<spec.md>] [<registry version>]
//
// With no arguments it checks the vendored spec against its own registry, which
// is what the traceability test does. To move to a new spec version, vendor its
// Markdown as spec/<version>/ai-catalog.md, copy the previous registry to
// requirements/<version>.yaml, and run this: it lists the statements the new spec
// adds (to number and classify) and the ones it drops (to retire).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extract, normalize } from "./extract.ts";
import { loadRegistry, specPath } from "./registry.ts";

export interface SyncDiff {
  /** Statements in the spec with no registry entry. */
  missing: { section: string; text: string }[];
  /** Registry entries whose text is not in the spec. */
  stale: { id: string; text: string }[];
  /** Registry entries whose section differs from where the spec puts their text. */
  moved: { id: string; registry: string; spec: string }[];
}

export function sync(markdown: string, version: string): SyncDiff {
  const registry = loadRegistry(version);
  const { statements, cddl, prose } = extract(markdown);
  const spec = [
    ...statements.map((s) => ({ section: s.section, text: normalize(s.text) })),
    ...cddl.map((r) => ({ section: r.section, text: normalize(r.text) })),
  ];
  // The same sentence can appear in several sections ("It MUST contain:"), so a
  // statement is its section and its text, and each is matched once.
  const unmatched = new Map<string, number>();
  const key = (section: string, text: string) => `${section}\u0000${text}`;
  for (const s of spec) unmatched.set(key(s.section, s.text), (unmatched.get(key(s.section, s.text)) ?? 0) + 1);
  const stale: SyncDiff["stale"] = [];
  for (const r of registry.requirements) {
    if (r.definition) {
      // A definition carries no keyword, so it is not extracted; it must still be in its section.
      if (!(prose.get(r.section) ?? "").includes(normalize(r.text))) stale.push({ id: r.id, text: r.text });
      continue;
    }
    const k = key(r.section, normalize(r.text));
    const n = unmatched.get(k) ?? 0;
    if (n > 0) unmatched.set(k, n - 1);
    else stale.push({ id: r.id, text: r.text });
  }
  const missing = spec.filter((s) => {
    const k = key(s.section, s.text);
    const n = unmatched.get(k) ?? 0;
    if (n === 0) return false;
    unmatched.set(k, n - 1);
    return true;
  });
  // A stale entry whose text is missing elsewhere moved section.
  const moved: SyncDiff["moved"] = [];
  for (const st of [...stale]) {
    const m = missing.find((x) => x.text === normalize(st.text));
    if (!m) continue;
    const r = registry.requirements.find((x) => x.id === st.id)!;
    moved.push({ id: st.id, registry: r.section, spec: m.section });
    stale.splice(stale.indexOf(st), 1);
    missing.splice(missing.indexOf(m), 1);
  }
  return { missing, stale, moved };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[3] ?? "0.9";
  const file = process.argv[2] ?? fileURLToPath(specPath(version));
  const diff = sync(readFileSync(file, "utf8"), version);
  for (const m of diff.missing) console.log(`+ [${m.section}] ${m.text}`);
  for (const s of diff.stale) console.log(`- ${s.id} ${s.text}`);
  for (const m of diff.moved) console.log(`~ ${m.id} is in ${m.spec}, registered under ${m.registry}`);
  const n = diff.missing.length + diff.stale.length + diff.moved.length;
  console.log(n === 0 ? `requirements/${version}.yaml matches ${file}` : `${n} differences`);
  process.exitCode = n === 0 ? 0 : 1;
}
