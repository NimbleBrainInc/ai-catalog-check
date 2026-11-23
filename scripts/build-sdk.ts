// Builds Vercel's TypeScript SDK for the AI Catalog spec (vercel-labs/ai-catalog-sdk)
// at a pinned commit, for the cross-check in test/sdk-oracle.test.ts.
//
//   node scripts/build-sdk.ts      prints the built SDK's directory
//
// A release reaches the SDK's GitHub tag before npm, so it is built from the
// commit of the tag that implements the spec version this suite covers. When the
// spec moves, set SDK_COMMIT to the SDK release for it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SDK_REPO = "https://github.com/vercel-labs/ai-catalog-sdk.git";
export const SDK_COMMIT = "1fd9de447b612387e8b7955110614de213fc6ddb"; // v0.1.0, spec 0.9
const PNPM = "pnpm@11.1.3"; // the SDK's `packageManager`

export const sdkDir = fileURLToPath(new URL(`../.cache/ai-catalog-sdk-${SDK_COMMIT}/`, import.meta.url));

export function buildSdk(): string {
  const done = `${sdkDir}.built`;
  if (existsSync(done)) return sdkDir;
  rmSync(sdkDir, { recursive: true, force: true });
  mkdirSync(sdkDir, { recursive: true });
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: sdkDir, stdio: ["ignore", "ignore", "inherit"] });
  run("git", ["init", "--quiet"]);
  run("git", ["fetch", "--quiet", "--depth", "1", SDK_REPO, SDK_COMMIT]);
  run("git", ["checkout", "--quiet", "FETCH_HEAD"]);
  run("npx", ["--yes", PNPM, "install", "--frozen-lockfile", "--silent"]);
  run("npx", ["--yes", PNPM, "run", "--silent", "build"]);
  writeFileSync(done, "");
  return sdkDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(buildSdk());
}
