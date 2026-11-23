#!/usr/bin/env node
// ai-catalog-conformance: checks AI Catalog documents against the spec.

import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { cachingFetcher } from "./checks/fetch.ts";
import { loadRegistry } from "./registry.ts";
import { github, json, text } from "./report.ts";
import { type Baseline, run } from "./run.ts";

const USAGE = `Usage: ai-catalog-conformance [options] <catalog>...

Each <catalog> is a file path or an http(s) URL. Checks AI Catalog ${loadRegistry().spec.version}.

Options:
  --fetch              Also fetch the catalog's URL and the artifacts its entries name
  --baseline <file>    YAML listing failures to expect: expected: [{id, reason}]
  --format <format>    text (default), json, or github (annotations for GitHub Actions)
  --strict             Fail on warnings as well as failures
  -v, --verbose        List every result, passing ones too, with the spec sentence each checks
  -h, --help           Show this help

Exits 1 when a requirement fails, 2 on a usage error.`;

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        fetch: { type: "boolean", default: false },
        baseline: { type: "string" },
        format: { type: "string", default: "text" },
        strict: { type: "boolean", default: false },
        verbose: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length === 0 || !["text", "json", "github"].includes(values.format)) {
    console.error(USAGE);
    return 2;
  }
  const baseline = values.baseline
    ? (YAML.parse(readFileSync(values.baseline, "utf8")) as Baseline)
    : undefined;

  const fetcher = cachingFetcher();
  let failed = false;
  const reports: string[] = [];
  for (const source of positionals) {
    const remote = /^https?:\/\//.test(source);
    let textIn: string;
    let catalogResponse;
    if (remote) {
      catalogResponse = await fetcher(source);
      if (catalogResponse.status < 200 || catalogResponse.status > 299) {
        console.error(`${source} answered ${catalogResponse.status}`);
        failed = true;
        continue;
      }
      textIn = new TextDecoder().decode(catalogResponse.bytes);
    } else {
      textIn = readFileSync(source, "utf8");
    }
    const report = await run({
      text: textIn,
      source,
      fetch: values.fetch,
      ...(remote ? { catalogUrl: catalogResponse!.url, catalogResponse } : {}),
      fetcher,
      ...(baseline ? { baseline } : {}),
      strict: values.strict,
    });
    failed ||= report.failed;
    reports.push(
      values.format === "json"
        ? json(report)
        : values.format === "github"
          ? github(report, remote ? undefined : source, { verbose: values.verbose })
          : text(report, { verbose: values.verbose }),
    );
    // Under GitHub Actions, the report also goes to the job's summary page.
    if (values.format === "github" && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text(report, { verbose: values.verbose })}\n\`\`\`\n\n`);
    }
  }
  console.log(values.format === "json" && reports.length > 1 ? `[${reports.join(",\n")}]` : reports.join("\n\n"));
  return failed ? 1 : 0;
}

process.exitCode = await main();
