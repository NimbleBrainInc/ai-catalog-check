// The package as npm publishes it: packed, unpacked where no node_modules can be
// found, and run. It declares no runtime dependencies, so this is what a user gets.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("the packed package", () => {
  let dir = "";
  let pkg = "";
  const cli = (...args: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(pkg, "dist", "cli.js"), ...args], { cwd: dir, encoding: "utf8" }) };
    } catch (error) {
      const e = error as { status: number; stdout: string };
      return { code: e.status, out: e.stdout };
    }
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "ai-catalog-check-pack-"));
    // `npm pack` runs `prepare`, which builds dist/ as a publish does.
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", dir], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    ) as { filename: string }[];
    execFileSync("tar", ["-xzf", join(dir, packed!.filename), "-C", dir]);
    pkg = join(dir, "package");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("declares no runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as Record<string, unknown>;
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "bundleDependencies"]) {
      assert.equal(manifest[field], undefined, field);
    }
  });

  it("ships the licenses of what it bundles", () => {
    const licenses = readFileSync(join(pkg, "dist", "THIRD-PARTY-LICENSES.md"), "utf8");
    for (const name of ["parse5", "yaml", "entities", "http-link-header"]) assert.match(licenses, new RegExp(`^## ${name} `, "m"));
    assert.ok(readFileSync(join(pkg, "NOTICE"), "utf8").length > 0);
  });

  it("runs with nothing else installed", () => {
    const version = cli("--version");
    assert.equal(version.code, 0);
    assert.match(version.out, /^ai-catalog-check \d+\.\d+\.\d+ \(checks AI Catalog [\d., ]+\)$/m);

    const example = join(pkg, "skills", "ai-catalog-check", "SKILL.md");
    const starter = /## Starting a catalog[\s\S]*?```json\n([\s\S]*?)```/.exec(readFileSync(example, "utf8"))![1]!;
    execFileSync("sh", ["-c", `cat > ${JSON.stringify(join(dir, "catalog.json"))}`], { input: starter });
    const report = cli("catalog.json");
    assert.equal(report.code, 0, report.out);
    assert.match(report.out, /✓ Conforms at Level 2 \(Discoverable\)/);
  });
});
