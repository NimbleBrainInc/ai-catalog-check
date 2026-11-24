// Builds dist/: the CLI and the library, each bundled with its dependencies, so
// the published package installs nothing else. The dependencies are fixed by
// package-lock.json and reviewed when it changes, rather than resolved on every
// install. dist/THIRD-PARTY-LICENSES.md carries the license of everything bundled.
//
// Plain JavaScript, so it runs on the oldest Node the package supports: `npx
// github:...` installs build the package on the user's machine.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const node = /(\d+\.\d+)/.exec(pkg.engines.node)[1];

rmSync("dist", { recursive: true, force: true });

const result = await build({
  entryPoints: ["src/cli.ts", "src/index.ts"],
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: `node${node}`,
  metafile: true,
  logLevel: "warning",
  // A bundled CommonJS module may `require` a Node built-in; ESM has no `require`,
  // so each output file gets one.
  banner: { js: 'import { createRequire as __bundleRequire } from "node:module"; const require = __bundleRequire(import.meta.url);' },
});

// Declarations for the library's types.
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });

// The license of each bundled package, and of the code copied into src/vendor/.
const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) bundled.add(m[1]);
}
const sections = [...bundled].sort().map((name) => {
  const dir = join("node_modules", name);
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  if (!file) throw new Error(`${name} has no license file to ship with the bundle`);
  return `## ${name} ${meta.version} (${meta.license})\n\n\`\`\`\n${readFileSync(join(dir, file), "utf8").trim()}\n\`\`\``;
});
const vendored = readFileSync("src/vendor/http-link-header.ts", "utf8");
const mit = vendored.slice(vendored.indexOf("// The MIT License"), vendored.indexOf("THE SOFTWARE.") + "THE SOFTWARE.".length);
sections.push(
  `## http-link-header 1.1.4 (MIT), copied into src/vendor/http-link-header.ts and modified\n\n\`\`\`\n${mit.replace(/^\/\/ ?/gm, "")}\n\`\`\``,
);
writeFileSync(
  "dist/THIRD-PARTY-LICENSES.md",
  `# Third-party licenses\n\nThe code below is bundled into this package's dist/.\n\n${sections.join("\n\n")}\n`,
);
