// The agent skill in skills/ai-catalog-check ships with the CLI, so it is held to
// the CLI: its starter catalog conforms, and every requirement it names exists.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import YAML from "yaml";
import { LATEST_SPEC, loadRegistry } from "../src/registry.ts";
import { run } from "../src/run.ts";

const skill = readFileSync(new URL("../skills/ai-catalog-check/SKILL.md", import.meta.url), "utf8");

describe("skills/ai-catalog-check", () => {
  it("has Agent Skills frontmatter: name matching its folder, a description within 1024 characters", () => {
    const front = YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(skill)![1]!) as { name: string; description: string };
    assert.equal(front.name, "ai-catalog-check");
    assert.ok(front.description.length > 0 && front.description.length <= 1024);
  });

  it("starts authors from a catalog that conforms at Level 2 with no warnings", async () => {
    const starter = /## Starting a catalog[\s\S]*?```json\n([\s\S]*?)```/.exec(skill)![1]!;
    const report = await run({ text: starter, source: "starter" });
    assert.equal(report.level, 2);
    assert.deepEqual(report.results.filter((r) => !["pass", "n/a", "skipped"].includes(r.status)).map((r) => r.id), []);
  });

  it("names only requirements, and sections of requirements, that exist", () => {
    const { requirements, sections } = loadRegistry(LATEST_SPEC);
    const ids = new Set(requirements.map((r) => r.id));
    const prefixes = Object.keys(sections).join("|");
    for (const [ref] of skill.matchAll(new RegExp(`\\b(?:${prefixes})-(?:\\d+|\\\\\\*)`, "g"))) {
      if (ref.endsWith("\\*")) {
        const prefix = ref.slice(0, -3);
        assert.ok(requirements.some((r) => r.id.startsWith(`${prefix}-`) && r.check), `${ref}: no checked ${prefix} requirement`);
      } else {
        assert.ok(ids.has(ref), `${ref} does not exist`);
      }
    }
  });
});
